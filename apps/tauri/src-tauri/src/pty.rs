use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::coding_config::get_coding_agents;

const MAX_BUFFER_BYTES: usize = 256 * 1024; // 256 KB scrollback replay buffer
const MAX_PTY_AGE: Duration = Duration::from_secs(3600); // 1 hour

pub struct PtyHandle {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    /// Rolling output buffer — replayed to a fresh xterm on reconnect.
    pub output_buffer: Arc<Mutex<Vec<u8>>>,
    /// When this PTY was spawned — used to enforce the 1-hour limit.
    pub created_at: Instant,
    /// Set to true when this handle is being replaced (resume/expiry).
    /// Prevents the old reader thread from emitting stale exit events.
    pub cancelled: Arc<AtomicBool>,
}

pub type PtyState = Arc<Mutex<HashMap<String, PtyHandle>>>;

#[derive(Clone, Serialize, Deserialize)]
pub struct SharedLoginPath(pub Arc<Mutex<String>>);

pub fn capture_login_path() -> String {
    // Use the user's own shell so nvm/homebrew/fnm paths are included.
    // Source the rc file (~/.zshrc, ~/.bashrc, etc.) because most users put
    // version-manager setup there rather than in the login profile.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("sh")
        .to_string();
    let cmd = format!("source ~/.{}rc 2>/dev/null; echo $PATH", shell_name);

    let output = std::process::Command::new(&shell)
        .args(["-lc", &cmd])
        .output();

    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => std::env::var("PATH").unwrap_or_default(),
    }
}

fn emit_error(app: &AppHandle, db_id: &str, message: &str) {
    log::error!("[pty] {} error: {}", db_id, message);
    let event = format!("pty://error/{}", db_id);
    let _ = app.emit(&event, serde_json::json!({ "message": message }));
}

#[tauri::command]
pub fn spawn_pty(
    session_db_id: String,
    agent: String,
    dir: String,
    resume_session_id: Option<String>,
    cols: u16,
    rows: u16,
    state: State<PtyState>,
    login_path: State<SharedLoginPath>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!(
        "[pty] spawn_pty request db_id={} agent={} dir={} resume={} size={}x{}",
        session_db_id,
        agent,
        dir,
        resume_session_id.as_deref().unwrap_or("<none>"),
        cols,
        rows
    );

    // --- Reconnect / resume logic ---
    // If a PTY already exists for this session:
    //   - Still running → always reconnect (replay buffer). Never kill a live process
    //     just because the xterm was remounted (e.g. tab switch).
    //   - Exited + resume_session_id.is_none() → replay buffer + re-emit exit event.
    //   - Exited + resume_session_id.is_some() → kill stale handle, spawn fresh with --resume.
    enum Action {
        Reconnect { buffer: Vec<u8>, emit_exit: bool },
        Spawn,
    }

    let action = {
        let mut map = state.lock().unwrap();
        if let Some(handle) = map.get_mut(&session_db_id) {
            if handle.created_at.elapsed() < MAX_PTY_AGE {
                let exited = handle.child.try_wait().ok().flatten().is_some();
                if !exited {
                    // PTY is still running — reconnect regardless of resume_session_id.
                    let buffer = handle.output_buffer.lock().unwrap().clone();
                    log::info!(
                        "[pty] {} reconnect to live PTY, replaying {} bytes",
                        session_db_id,
                        buffer.len()
                    );
                    Action::Reconnect { buffer, emit_exit: false }
                } else if resume_session_id.is_none() {
                    // PTY exited, no resume requested — replay buffer + exit event.
                    let buffer = handle.output_buffer.lock().unwrap().clone();
                    log::info!(
                        "[pty] {} reconnect to exited PTY, replaying {} bytes + exit",
                        session_db_id,
                        buffer.len()
                    );
                    Action::Reconnect { buffer, emit_exit: true }
                } else {
                    // PTY exited AND caller wants --resume — remove stale handle, spawn fresh.
                    log::info!(
                        "[pty] {} previous PTY exited, respawning with --resume",
                        session_db_id
                    );
                    handle.cancelled.store(true, Ordering::Relaxed);
                    let _ = handle.child.kill();
                    map.remove(&session_db_id);
                    Action::Spawn
                }
            } else {
                // Too old — kill and fall through to spawn
                log::info!(
                    "[pty] {} previous PTY aged out (>1h), respawning",
                    session_db_id
                );
                handle.cancelled.store(true, Ordering::Relaxed);
                let _ = handle.child.kill();
                map.remove(&session_db_id);
                Action::Spawn
            }
        } else {
            Action::Spawn
        }
    };

    match action {
        Action::Reconnect { buffer, emit_exit } => {
            if !buffer.is_empty() {
                let data = String::from_utf8_lossy(&buffer).to_string();
                let _ = app.emit(&format!("pty://data/{}", session_db_id), data);
            }
            if emit_exit {
                let _ = app.emit(&format!("pty://exit/{}", session_db_id), ());
            }
            return Ok(());
        }
        Action::Spawn => {} // continue below
    }

    // --- Spawn new PTY ---
    let agents = get_coding_agents();
    let agent_info = agents
        .iter()
        .find(|a| a.name == agent)
        .ok_or_else(|| {
            let available: Vec<&str> = agents.iter().map(|a| a.name.as_str()).collect();
            let msg = format!(
                "Unknown agent: {} (available: {:?})",
                agent, available
            );
            log::error!("[pty] {} {}", session_db_id, msg);
            msg
        })?;

    let path_str = login_path.0.lock().unwrap().clone();

    // Build final args up front so we can log them before spawn.
    let resolved_args: Vec<String> = if let Some(ref ext_id) = resume_session_id {
        agent_info
            .interactive_resume_args
            .as_deref()
            .unwrap_or(&agent_info.resume_args)
            .iter()
            .map(|a| a.replace("{sessionId}", ext_id))
            .collect()
    } else {
        agent_info
            .interactive_args
            .as_deref()
            .unwrap_or(&agent_info.args)
            .iter()
            .cloned()
            .collect()
    };

    log::info!(
        "[pty] {} spawning command={} args={:?} cwd={} PATH_len={} (first 200 chars: {})",
        session_db_id,
        agent_info.command,
        resolved_args,
        dir,
        path_str.len(),
        path_str.chars().take(200).collect::<String>()
    );

    // Sanity checks — log warnings but still attempt spawn so the underlying
    // error surfaces in case the assumptions are wrong.
    if !std::path::Path::new(&dir).exists() {
        log::warn!(
            "[pty] {} working directory does not exist: {}",
            session_db_id, dir
        );
    }
    if agent_info.command.contains('/') == false {
        // relative command name — must be on PATH
        let which = std::process::Command::new("which")
            .arg(&agent_info.command)
            .env("PATH", &path_str)
            .output();
        match which {
            Ok(o) if o.status.success() => {
                log::info!(
                    "[pty] {} resolved {} -> {}",
                    session_db_id,
                    agent_info.command,
                    String::from_utf8_lossy(&o.stdout).trim()
                );
            }
            Ok(_) => log::warn!(
                "[pty] {} `{}` not found on captured PATH",
                session_db_id, agent_info.command
            ),
            Err(e) => log::warn!(
                "[pty] {} failed to run `which {}`: {}",
                session_db_id, agent_info.command, e
            ),
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| {
            let msg = format!("Failed to open PTY: {}", e);
            log::error!("[pty] {} {}", session_db_id, msg);
            msg
        })?;

    let mut cmd = CommandBuilder::new(&agent_info.command);
    for arg in &resolved_args {
        cmd.arg(arg);
    }

    cmd.cwd(&dir);
    cmd.env("PATH", &path_str);
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| {
        let msg = format!("Failed to start {}: {}", agent_info.command, e);
        emit_error(&app, &session_db_id, &msg);
        msg
    })?;

    log::info!("[pty] {} spawn succeeded, child pid live", session_db_id);

    let master = pair.master;
    let writer = master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let output_buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let cancelled: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));

    // Reader thread — emit output and maintain scrollback buffer
    let reader = master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    let app_reader = app.clone();
    let db_id_reader = session_db_id.clone();
    let buffer_reader = output_buffer.clone();
    let cancelled_reader = cancelled.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        // Holds a trailing partial UTF-8 codepoint split across a read()
        // boundary. Without this, from_utf8_lossy replaces the split bytes
        // with U+FFFD, which is rendered as 2 cells in xterm where the TUI's
        // diff-renderer expects 1 — every cursor-relative erase after that
        // lands off by one cell, leaving stale spinner/status lines behind.
        let mut pending: Vec<u8> = Vec::new();
        let emit_event = format!("pty://data/{}", db_id_reader);
        let mut total_bytes_read: usize = 0;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    log::info!(
                        "[pty] {} reader EOF after {} bytes",
                        db_id_reader, total_bytes_read
                    );
                    break;
                }
                Ok(n) => {
                    total_bytes_read += n;
                    if cancelled_reader.load(Ordering::Relaxed) { break; }
                    // Always append raw bytes to scrollback — replay on
                    // reconnect converts the full contiguous buffer once.
                    {
                        let mut b = buffer_reader.lock().unwrap();
                        b.extend_from_slice(&buf[..n]);
                        if b.len() > MAX_BUFFER_BYTES {
                            let drain = b.len() - MAX_BUFFER_BYTES / 2;
                            b.drain(..drain);
                        }
                    }
                    pending.extend_from_slice(&buf[..n]);
                    let emit_up_to = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) => match e.error_len() {
                            // Truncated trailing codepoint — hold the tail.
                            None => e.valid_up_to(),
                            // Genuinely invalid bytes — emit everything lossy
                            // rather than stalling the stream.
                            Some(_) => pending.len(),
                        },
                    };
                    if emit_up_to > 0 {
                        let data = String::from_utf8_lossy(&pending[..emit_up_to]).to_string();
                        let _ = app_reader.emit(&emit_event, data);
                        pending.drain(..emit_up_to);
                    }
                    // A real UTF-8 codepoint is ≤ 4 bytes; anything longer is
                    // junk, flush it lossy so we don't accumulate forever.
                    if pending.len() > 4 {
                        let data = String::from_utf8_lossy(&pending).to_string();
                        let _ = app_reader.emit(&emit_event, data);
                        pending.clear();
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[pty] {} reader error after {} bytes: {}",
                        db_id_reader, total_bytes_read, e
                    );
                    break;
                }
            }
        }
        if !pending.is_empty() {
            let data = String::from_utf8_lossy(&pending).to_string();
            let _ = app_reader.emit(&emit_event, data);
        }
        if !cancelled_reader.load(Ordering::Relaxed) {
            log::info!("[pty] {} emitting exit event", db_id_reader);
            let _ = app_reader.emit(&format!("pty://exit/{}", db_id_reader), ());
        }
    });

    // Session-ID detection thread
    let app_sid = app.clone();
    let db_id_sid = session_db_id.clone();
    let dir_clone = dir.clone();
    let path_str_sid = path_str.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));

        let output = std::process::Command::new("corebrain")
            .args(["coding", "list", "--dir", &dir_clone, "--json"])
            .env("PATH", &path_str_sid)
            .output();

        match output {
            Ok(o) => {
                if !o.status.success() {
                    return;
                }
                let text = String::from_utf8_lossy(&o.stdout);
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(first) = json["sessions"].as_array().and_then(|a| a.first()) {
                        if let Some(ext_id) = first.get("sessionId").and_then(|v| v.as_str()) {
                            let _ = app_sid.emit(
                                &format!("pty://session-id/{}", db_id_sid),
                                serde_json::json!({ "externalSessionId": ext_id }),
                            );
                        }
                    }
                }
            }
            Err(_) => {}
        }
    });

    // Store handle
    state.lock().unwrap().insert(
        session_db_id,
        PtyHandle {
            master,
            writer,
            child,
            output_buffer,
            created_at: Instant::now(),
            cancelled,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn write_pty(
    session_db_id: String,
    data: String,
    state: State<PtyState>,
    app: AppHandle,
) {
    let mut map = state.lock().unwrap();
    if let Some(handle) = map.get_mut(&session_db_id) {
        if let Err(e) = handle.writer.write_all(data.as_bytes()) {
            // If the write fails, the child process likely exited — emit exit
            // so the frontend shows "Session ended" rather than a write error.
            let exit_status = handle.child.try_wait().ok().flatten();
            match exit_status {
                Some(status) => {
                    log::warn!(
                        "[pty] {} write failed because child exited (status={:?}): {}",
                        session_db_id, status, e
                    );
                    let _ = app.emit(&format!("pty://exit/{}", session_db_id), ());
                }
                None => {
                    log::error!(
                        "[pty] {} write failed but child still running: {}",
                        session_db_id, e
                    );
                    emit_error(&app, &session_db_id, &format!("Write failed: {}", e));
                }
            }
        }
    } else {
        log::warn!("[pty] {} write_pty called but session not in map", session_db_id);
        emit_error(&app, &session_db_id, "Session not running");
    }
}

#[tauri::command]
pub fn resize_pty(
    session_db_id: String,
    cols: u16,
    rows: u16,
    state: State<PtyState>,
) {
    let map = state.lock().unwrap();
    if let Some(handle) = map.get(&session_db_id) {
        let _ = handle.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
}

#[tauri::command]
pub fn kill_pty(session_db_id: String, state: State<PtyState>) {
    let mut map = state.lock().unwrap();
    if let Some(mut handle) = map.remove(&session_db_id) {
        let _ = handle.child.kill();
    }
}

pub fn kill_all_ptys(state: &PtyState) {
    let mut map = state.lock().unwrap();
    for (_, mut handle) in map.drain() {
        let _ = handle.child.kill();
    }
}
