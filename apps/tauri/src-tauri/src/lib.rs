#[cfg(target_os = "macos")]
mod screen_context;
#[cfg(target_os = "macos")]
mod apps;
#[cfg(target_os = "macos")]
mod capture;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::State;

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl, runtime::Object};

// ── Shared state ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenContextSettings {
    /// Whether screen context capture is active. Off by default.
    #[serde(default = "default_paused")]
    pub paused: bool,
    /// Allowlist — only capture from these apps. Empty = capture nothing.
    #[serde(default)]
    pub enabled_apps: HashSet<String>,
    /// Runtime-only: all UI apps seen on this machine. Not persisted.
    #[serde(skip)]
    pub seen_apps: Vec<String>,
}

fn default_paused() -> bool { true }

impl Default for ScreenContextSettings {
    fn default() -> Self {
        Self {
            paused: true, // off by default
            enabled_apps: HashSet::new(),
            seen_apps: Vec::new(),
        }
    }
}

pub type SharedScreenContextSettings = Arc<Mutex<ScreenContextSettings>>;

// ── Auth state ────────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct AuthState {
    /// PAT stored after desktop login. Used for outbound API calls from Rust.
    pub pat: Option<String>,
}

pub type SharedAuthState = Arc<Mutex<AuthState>>;

// ── Settings persistence (~/.corebrain/config.json) ──────────────────────────

fn corebrain_config_path() -> Option<std::path::PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|h| std::path::PathBuf::from(h).join(".corebrain").join("config.json"))
}

fn load_screen_context_settings() -> ScreenContextSettings {
    let path = match corebrain_config_path() {
        Some(p) => p,
        None => return ScreenContextSettings::default(),
    };
    let json: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let sc = &json["preferences"]["screenContext"];
    if sc.is_null() {
        return ScreenContextSettings::default();
    }
    serde_json::from_value(sc.clone()).unwrap_or_default()
}

fn save_screen_context_settings(settings: &ScreenContextSettings) {
    let path = match corebrain_config_path() {
        Some(p) => p,
        None => return,
    };
    let mut json: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if !json["preferences"].is_object() {
        json["preferences"] = serde_json::json!({});
    }
    json["preferences"]["screenContext"] = serde_json::json!({
        "paused": settings.paused,
        "enabled_apps": settings.enabled_apps.iter().collect::<Vec<_>>(),
    });

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(content) = serde_json::to_string_pretty(&json) {
        let _ = std::fs::write(&path, content);
    }
}

// ── Running apps helpers ──────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct RunningApp {
    pub name: String,
}

#[cfg(target_os = "macos")]
unsafe fn icon_base64_for_app(app: *mut Object) -> Option<String> {
    let icon: *mut Object = msg_send![app, icon];
    if icon.is_null() { return None; }

    let tiff: *mut Object = msg_send![icon, TIFFRepresentation];
    if tiff.is_null() { return None; }

    let rep: *mut Object =
        msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
    if rep.is_null() { return None; }

    let props: *mut Object = msg_send![class!(NSDictionary), dictionary];
    // NSBitmapImageFileTypePNG = 4
    let png: *mut Object =
        msg_send![rep, representationUsingType: 4usize properties: props];
    if png.is_null() { return None; }

    let length: usize = msg_send![png, length];
    let bytes: *const u8 = msg_send![png, bytes];
    let slice = std::slice::from_raw_parts(bytes, length);
    Some(base64::engine::general_purpose::STANDARD.encode(slice))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Returns all visible (regular activation policy) running apps — names only.
/// Fast: no icon conversion.
#[cfg(target_os = "macos")]
#[tauri::command]
fn get_running_apps() -> Vec<RunningApp> {
    unsafe {
        let ws: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let all: *mut Object = msg_send![ws, runningApplications];
        let count: usize = msg_send![all, count];
        let mut result = Vec::new();

        for i in 0..count {
            let app: *mut Object = msg_send![all, objectAtIndex: i];
            // NSApplicationActivationPolicyRegular == 0
            let policy: i64 = msg_send![app, activationPolicy];
            if policy != 0 { continue; }

            let name_obj: *mut Object = msg_send![app, localizedName];
            if name_obj.is_null() { continue; }
            let bytes: *const std::os::raw::c_char = msg_send![name_obj, UTF8String];
            if bytes.is_null() { continue; }
            let name = std::ffi::CStr::from_ptr(bytes).to_string_lossy().into_owned();
            result.push(RunningApp { name });
        }
        result
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn get_running_apps() -> Vec<RunningApp> { vec![] }

/// Returns the base64 PNG icon for a single running app by name. Called lazily per app.
#[cfg(target_os = "macos")]
#[tauri::command]
fn get_app_icon(name: String) -> Option<String> {
    unsafe {
        let ws: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let all: *mut Object = msg_send![ws, runningApplications];
        let count: usize = msg_send![all, count];

        for i in 0..count {
            let app: *mut Object = msg_send![all, objectAtIndex: i];
            let name_obj: *mut Object = msg_send![app, localizedName];
            if name_obj.is_null() { continue; }
            let bytes: *const std::os::raw::c_char = msg_send![name_obj, UTF8String];
            if bytes.is_null() { continue; }
            let app_name = std::ffi::CStr::from_ptr(bytes).to_string_lossy();
            if app_name == name {
                return icon_base64_for_app(app);
            }
        }
        None
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn get_app_icon(_name: String) -> Option<String> { None }

#[tauri::command]
fn get_screen_context_settings(
    state: State<SharedScreenContextSettings>,
) -> serde_json::Value {
    let s = state.lock().unwrap();
    serde_json::json!({
        "paused": s.paused,
        "enabled_apps": s.enabled_apps.iter().collect::<Vec<_>>(),
        "seen_apps": s.seen_apps,
    })
}

#[tauri::command]
fn set_screen_context_paused(paused: bool, state: State<SharedScreenContextSettings>) {
    let snapshot = {
        let mut s = state.lock().unwrap();
        s.paused = paused;
        s.clone()
    };
    save_screen_context_settings(&snapshot);
}

#[tauri::command]
fn set_enabled_apps(enabled: Vec<String>, state: State<SharedScreenContextSettings>) {
    let snapshot = {
        let mut s = state.lock().unwrap();
        s.enabled_apps = enabled.into_iter().collect();
        s.clone()
    };
    save_screen_context_settings(&snapshot);
}

/// Called from the frontend after desktop login to persist the PAT for Rust API calls.
#[tauri::command]
fn store_pat(token: String, state: State<SharedAuthState>) {
    state.lock().unwrap().pat = Some(token);
}

// ── App entry point ───────────────────────────────────────────────────────────

pub fn run() {
    let settings: SharedScreenContextSettings =
        Arc::new(Mutex::new(ScreenContextSettings::default()));
    let auth: SharedAuthState =
        Arc::new(Mutex::new(AuthState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(settings.clone())
        .manage(auth.clone())
        .invoke_handler(tauri::generate_handler![
            get_screen_context_settings,
            set_screen_context_paused,
            set_enabled_apps,
            get_running_apps,
            get_app_icon,
            store_pat,
        ])
        .setup(move |_app| {
            *settings.lock().unwrap() = load_screen_context_settings();
            #[cfg(target_os = "macos")]
            screen_context::start_polling(settings.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
