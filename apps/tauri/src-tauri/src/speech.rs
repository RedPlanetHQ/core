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
    #[serde(default)]
    voices: Option<Vec<serde_json::Value>>,
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

            // Surface speech-pipeline events in the main log stream so we
            // can see what the recognizer is hearing without opening the
            // webview devtools.
            match ev.event.as_str() {
                "partial" => log::info!(
                    "[speech] partial: {}",
                    ev.text.as_deref().unwrap_or("")
                ),
                "final" => log::info!(
                    "[speech] final: {}",
                    ev.text.as_deref().unwrap_or("")
                ),
                "tts-started" => log::info!("[speech] tts-started"),
                "tts-ended" => log::info!("[speech] tts-ended"),
                "permissions" => log::info!(
                    "[speech] permissions mic={} speech={}",
                    ev.mic.as_deref().unwrap_or("?"),
                    ev.speech.as_deref().unwrap_or("?")
                ),
                "ready" => log::info!("[speech] helper ready"),
                "error" => log::warn!(
                    "[speech] error: {}",
                    ev.message.as_deref().unwrap_or("(unknown)")
                ),
                other => log::debug!("[speech] event {other}"),
            }

            let payload = json!({
                "text": ev.text,
                "isFinal": ev.is_final,
                "message": ev.message,
                "mic": ev.mic,
                "speech": ev.speech,
                "voices": ev.voices,
            });
            let _ = app_handle.emit(&format!("voice:{}", ev.event), payload);
        }
    });

    // stderr drain (helper crashes / Swift natural logs)
    // Logged at info so they're visible alongside the other voice logs.
    if let Some(stderr) = stderr {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    log::info!("[core-voice/stderr] {line}");
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

    // Restore the saved voice preference so the freshly-spawned helper
    // uses it for all TTS output.
    if let Some(identifier) = read_voice_identifier() {
        let cmd = json!({"cmd": "set_voice", "identifier": identifier});
        if let Some(stdin) = proc.stdin.as_mut() {
            let mut line = serde_json::to_string(&cmd).unwrap();
            line.push('\n');
            let _ = stdin.write_all(line.as_bytes());
            let _ = stdin.flush();
            log::info!("[speech] restored voice preference: {identifier}");
        }
    }

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

// ── Voice preference persistence ──────────────────────────────────────────────
//
// Stored at `~/.corebrain/config.json` under `preferences.voice.identifier`.
// On every helper spawn we forward the saved identifier as a `set_voice`
// command so the recognizer/synthesizer use the right voice without
// requiring the React widget to set it.

fn config_path() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(h).join(".corebrain").join("config.json"))
}

fn read_voice_identifier() -> Option<String> {
    let path = config_path()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json["preferences"]["voice"]["identifier"]
        .as_str()
        .map(|s| s.to_string())
}

fn write_voice_identifier(identifier: &str) -> Result<(), String> {
    let path = config_path().ok_or_else(|| "no HOME".to_string())?;
    let mut json: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if !json["preferences"].is_object() {
        json["preferences"] = serde_json::json!({});
    }
    if !json["preferences"]["voice"].is_object() {
        json["preferences"]["voice"] = serde_json::json!({});
    }
    json["preferences"]["voice"]["identifier"] =
        serde_json::Value::String(identifier.to_string());

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let pretty = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&path, pretty).map_err(|e| e.to_string())?;
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
pub fn voice_cancel_listening<R: Runtime>(
    app: AppHandle<R>,
    state: State<SharedSpeech>,
) -> Result<(), String> {
    let mut proc = state.lock().unwrap();
    send_command(&app, &mut proc, json!({"cmd": "cancel_listening"}))
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

/// Ask the helper to enumerate installed voices. Result arrives
/// asynchronously as a `voice:voices` Tauri event.
#[tauri::command]
pub fn voice_list_voices<R: Runtime>(
    app: AppHandle<R>,
    state: State<SharedSpeech>,
) -> Result<(), String> {
    let mut proc = state.lock().unwrap();
    send_command(&app, &mut proc, json!({"cmd": "list_voices"}))
}

/// Persist the user's voice choice + push it to the running helper.
#[tauri::command]
pub fn voice_set_voice<R: Runtime>(
    app: AppHandle<R>,
    state: State<SharedSpeech>,
    identifier: String,
) -> Result<(), String> {
    write_voice_identifier(&identifier)?;
    let mut proc = state.lock().unwrap();
    send_command(
        &app,
        &mut proc,
        json!({"cmd": "set_voice", "identifier": identifier}),
    )
}

/// Read the persisted voice identifier (if any) from config.json.
#[tauri::command]
pub fn voice_get_voice() -> Option<String> {
    read_voice_identifier()
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
