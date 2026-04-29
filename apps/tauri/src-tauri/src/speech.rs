//! Speech bridge — spawns the bundled `core-voice` Swift helper and
//! forwards its newline-delimited JSON events to the Tauri frontend as
//! Tauri events. Commands flow the other way as `#[tauri::command]`s
//! that write to the helper's stdin.
//!
//! Process lifecycle: one helper per app run. Spawned lazily on first
//! command (or eagerly during `setup` if we want to pre-warm). If it
//! dies we restart on next command.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

#[derive(Default)]
pub struct SpeechProcess {
    child: Option<Child>,
    stdin: Option<std::process::ChildStdin>,
}

pub type SharedSpeech = Arc<Mutex<SpeechProcess>>;

#[derive(Deserialize)]
struct HelperEvent {
    event: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default, rename = "isFinal")]
    is_final: Option<bool>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    mic: Option<String>,
    #[serde(default)]
    speech: Option<String>,
}

fn helper_path() -> Option<PathBuf> {
    // Dev: look next to the cargo target binary. Release: Tauri places
    // bundled resources in the .app's Resources dir; we look there too.
    let candidates: Vec<PathBuf> = {
        let mut v = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                v.push(dir.join("core-voice"));
                v.push(dir.join("../Resources/core-voice"));
            }
        }
        // Cargo manifest layout (dev path build.rs writes to)
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        v.push(manifest.join("target/debug/core-voice"));
        v.push(manifest.join("target/release/core-voice"));
        v
    };

    candidates.into_iter().find(|p| p.exists())
}

fn spawn_helper<R: Runtime>(app: &AppHandle<R>) -> Result<(Child, std::process::ChildStdin), String> {
    let bin = helper_path()
        .ok_or_else(|| "core-voice helper binary not found — build with `swift build`".to_string())?;

    let mut child = Command::new(&bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn core-voice: {e}"))?;

    let stdin = child.stdin.take().ok_or("no stdin on helper")?;
    let stdout = child.stdout.take().ok_or("no stdout on helper")?;
    let stderr = child.stderr.take();

    // stdout reader → Tauri events
    let app_handle = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() { continue }
            let Ok(ev) = serde_json::from_str::<HelperEvent>(&line) else {
                log::warn!("[speech] non-JSON helper line: {line}");
                continue;
            };
            let payload = json!({
                "text": ev.text,
                "isFinal": ev.is_final,
                "message": ev.message,
                "mic": ev.mic,
                "speech": ev.speech,
            });
            let _ = app_handle.emit(&format!("voice:{}", ev.event), payload);
        }
    });

    // stderr drain (helper crashes / Swift logs)
    if let Some(stderr) = stderr {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    log::warn!("[core-voice] {line}");
                }
            }
        });
    }

    Ok((child, stdin))
}

fn ensure_running<R: Runtime>(
    app: &AppHandle<R>,
    proc: &mut SpeechProcess,
) -> Result<(), String> {
    // Check if existing child is still alive
    if let Some(child) = proc.child.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                proc.child = None;
                proc.stdin = None;
            }
            Ok(None) => return Ok(()),
            Err(_) => {
                proc.child = None;
                proc.stdin = None;
            }
        }
    }

    let (child, stdin) = spawn_helper(app)?;
    proc.child = Some(child);
    proc.stdin = Some(stdin);
    Ok(())
}

fn send_command<R: Runtime>(
    app: &AppHandle<R>,
    proc: &mut SpeechProcess,
    cmd: serde_json::Value,
) -> Result<(), String> {
    ensure_running(app, proc)?;
    let stdin = proc.stdin.as_mut().ok_or("helper stdin missing")?;
    let mut line = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("write to core-voice failed: {e}"))?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn voice_request_permissions<R: Runtime>(
    app: AppHandle<R>,
    state: State<SharedSpeech>,
) -> Result<(), String> {
    let mut proc = state.lock().unwrap();
    send_command(&app, &mut proc, json!({"cmd": "request_permissions"}))
}

#[tauri::command]
pub fn voice_start_listening<R: Runtime>(
    app: AppHandle<R>,
    state: State<SharedSpeech>,
) -> Result<(), String> {
    let mut proc = state.lock().unwrap();
    send_command(&app, &mut proc, json!({"cmd": "start_listening"}))
}

#[tauri::command]
pub fn voice_stop_listening<R: Runtime>(
    app: AppHandle<R>,
    state: State<SharedSpeech>,
) -> Result<(), String> {
    let mut proc = state.lock().unwrap();
    send_command(&app, &mut proc, json!({"cmd": "stop_listening"}))
}

#[tauri::command]
pub fn voice_speak<R: Runtime>(
    app: AppHandle<R>,
    state: State<SharedSpeech>,
    text: String,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }
    let mut proc = state.lock().unwrap();
    send_command(&app, &mut proc, json!({"cmd": "speak", "text": text}))
}

#[tauri::command]
pub fn voice_cancel_speech<R: Runtime>(
    app: AppHandle<R>,
    state: State<SharedSpeech>,
) -> Result<(), String> {
    let mut proc = state.lock().unwrap();
    send_command(&app, &mut proc, json!({"cmd": "cancel_speech"}))
}

// Used by lib.rs setup to register the SpeechProcess state.
pub fn shared_state() -> SharedSpeech {
    Arc::new(Mutex::new(SpeechProcess::default()))
}

// Manually drains and kills the helper on app exit. Tauri doesn't run
// Drop on managed states reliably, so we invoke this from the run loop's
// shutdown handler.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<SharedSpeech>() {
        let mut proc = state.lock().unwrap();
        if let Some(mut child) = proc.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        proc.stdin = None;
    }
}
