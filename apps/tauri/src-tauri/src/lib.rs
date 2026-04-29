#[cfg(target_os = "macos")]
mod screen_context;
#[cfg(target_os = "macos")]
mod apps;
#[cfg(target_os = "macos")]
mod capture;
#[cfg(target_os = "macos")]
mod speech;
#[cfg(target_os = "macos")]
mod voice_hotkey;
mod coding_config;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Listener, Manager, PhysicalPosition, State};
use tauri_plugin_notification::{NotificationExt, PermissionState};

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

/// Returns the local gateway ID from ~/.corebrain/config.json, if configured.
#[tauri::command]
fn get_gateway_id() -> Option<String> {
    read_gateway_id()
}

fn read_gateway_id() -> Option<String> {
    let path = corebrain_config_path()?;
    let json: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())?;
    json["preferences"]["gateway"]["id"]
        .as_str()
        .map(|s| s.to_string())
}

/// Fire a one-time native notification on launch if the local gateway isn't
/// configured yet. The first call also handles the macOS permission prompt.
fn maybe_notify_gateway_setup<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let gateway = read_gateway_id();
    log::info!("[notify] gateway_id present={}", gateway.is_some());
    // TEMP: always fire for testing — restore the early-return below before shipping.
    // if gateway.is_some() {
    //     return;
    // }

    let n = app.notification();

    let state = match n.permission_state() {
        Ok(s) => s,
        Err(err) => {
            log::warn!("[notify] permission_state failed: {}", err);
            return;
        }
    };
    log::info!("[notify] permission_state={:?}", state);

    let granted = match state {
        PermissionState::Granted => true,
        _ => match n.request_permission() {
            Ok(s) => {
                log::info!("[notify] request_permission -> {:?}", s);
                matches!(s, PermissionState::Granted)
            }
            Err(err) => {
                log::warn!("[notify] request_permission failed: {}", err);
                false
            }
        },
    };

    if !granted {
        log::warn!("[notify] notification permission not granted, skipping");
        return;
    }

    let title = "Set up your CORE gateway";
    let body = "CORE needs a local gateway to run coding sessions and tools on this Mac. Open CORE → Settings → Gateway to register one.";

    let result = n.builder().title(title).body(body).show();

    match result {
        Ok(()) => log::info!("[notify] gateway-setup notification dispatched"),
        Err(err) => log::warn!("[notify] tauri notification failed: {}", err),
    }

    // macOS-specific fallback: in `tauri dev` the binary runs without a proper
    // bundle ID, so UserNotifications silently no-ops. AppleScript works from
    // any process, so always fire it as a backstop. In production builds the
    // user sees one notification (the plugin path) because macOS dedupes by
    // identifier; the AppleScript fallback shows up only when the plugin fails.
    #[cfg(target_os = "macos")]
    notify_via_osascript(title, body);
}

#[cfg(target_os = "macos")]
fn notify_via_osascript(title: &str, body: &str) {
    // Escape double-quotes and backslashes for AppleScript string literals.
    let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display notification \"{}\" with title \"{}\"",
        esc(body),
        esc(title)
    );
    match std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
    {
        Ok(out) if out.status.success() => {
            log::info!("[notify] osascript notification dispatched");
        }
        Ok(out) => {
            log::warn!(
                "[notify] osascript failed: status={} stderr={}",
                out.status,
                String::from_utf8_lossy(&out.stderr)
            );
        }
        Err(err) => log::warn!("[notify] osascript spawn failed: {}", err),
    }
}

/// Called from the frontend after desktop login to persist the PAT for Rust API calls.
#[tauri::command]
fn store_pat(token: String, state: State<SharedAuthState>) {
    state.lock().unwrap().pat = Some(token);
}

// ── System tray ───────────────────────────────────────────────────────────────

fn build_tray_menu<R: tauri::Runtime>(
    manager: &impl Manager<R>,
    paused: bool,
) -> tauri::Result<Menu<R>> {
    let toggle_label = if paused { "Enable Capture" } else { "Pause Capture" };
    let toggle_i = MenuItem::with_id(manager, "toggle_capture", toggle_label, true, None::<&str>)?;
    let open_i = MenuItem::with_id(manager, "open", "Open CORE", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(manager, "quit", "Quit CORE", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(manager)?;
    let sep2 = PredefinedMenuItem::separator(manager)?;
    let items: &[&dyn tauri::menu::IsMenuItem<R>] = &[&toggle_i, &sep1, &open_i, &sep2, &quit_i];
    Menu::with_items(manager, items)
}

// ── Voice widget ──────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn handle_voice_invoke<R: tauri::Runtime>(app: &tauri::AppHandle<R>, payload: &str) {
    // payload shape: { pid, app, screen_frame: { x, y, width, height } }
    #[derive(Deserialize)]
    struct InvokePayload {
        pid: i32,
        app: String,
        screen_frame: ScreenFrameDe,
    }
    #[derive(Deserialize, Clone, Copy)]
    struct ScreenFrameDe {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }

    let parsed: InvokePayload = match serde_json::from_str(payload) {
        Ok(v) => v,
        Err(err) => {
            log::warn!("[voice] invoke payload parse failed: {err}");
            return;
        }
    };

    // Snapshot AX context for the pre-invocation frontmost app. Skip if
    // the app *is* CORE itself — we'd just capture our own UI.
    let bundle_self = app.config().identifier.clone();
    let is_self = parsed.app.eq_ignore_ascii_case("core")
        || parsed.app.eq_ignore_ascii_case(&bundle_self);

    let (title, text) = if parsed.pid > 0 && !is_self {
        let (title, text, _disabled) = screen_context::query(parsed.pid);
        (title, text)
    } else {
        (None, None)
    };

    let context_payload = serde_json::json!({
        "pageContext": {
            "app": parsed.app,
            "title": title,
            "text": text,
        }
    });

    // The voice window is declared in tauri.conf.json (visible: false).
    // Look it up; bail loudly if the config didn't load.
    let Some(window) = app.get_webview_window("voice") else {
        log::warn!("[voice] voice window not found — check tauri.conf.json");
        return;
    };

    // Position top-right of the active screen with a 24px inset.
    let inset: f64 = 24.0;
    let win_w: f64 = 360.0;
    let target_x = parsed.screen_frame.x + parsed.screen_frame.width - win_w - inset;
    let target_y = parsed.screen_frame.y + inset;
    let _ = window.set_position(PhysicalPosition::<i32>::new(
        target_x as i32,
        target_y as i32,
    ));

    let _ = window.show();
    let _ = window.set_focus();

    // Send context to the widget. It will start its own listening session.
    let _ = window.emit("voice:invoke-payload", context_payload);
}

// ── App entry point ───────────────────────────────────────────────────────────

pub fn run() {
    let settings: SharedScreenContextSettings =
        Arc::new(Mutex::new(ScreenContextSettings::default()));
    let auth: SharedAuthState =
        Arc::new(Mutex::new(AuthState::default()));

    #[cfg(target_os = "macos")]
    let speech_state = speech::shared_state();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Info)
            .build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(settings.clone())
        .manage(auth.clone());

    #[cfg(target_os = "macos")]
    let builder = builder.manage(speech_state.clone());

    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_screen_context_settings,
        set_screen_context_paused,
        set_enabled_apps,
        get_running_apps,
        get_app_icon,
        store_pat,
        get_gateway_id,
        coding_config::check_corebrain_installed,
        coding_config::get_coding_agents,
        speech::voice_request_permissions,
        speech::voice_start_listening,
        speech::voice_stop_listening,
        speech::voice_speak,
        speech::voice_cancel_speech,
    ]);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_screen_context_settings,
        set_screen_context_paused,
        set_enabled_apps,
        get_running_apps,
        get_app_icon,
        store_pat,
        get_gateway_id,
        coding_config::check_corebrain_installed,
        coding_config::get_coding_agents,
    ]);

    builder
        .setup(move |app| {
            *settings.lock().unwrap() = load_screen_context_settings();
            #[cfg(target_os = "macos")]
            screen_context::start_polling(settings.clone());

            // Voice widget — install global double-tap-Option hotkey and
            // wire it to the floating call-card window.
            #[cfg(target_os = "macos")]
            {
                voice_hotkey::install(app.handle().clone());

                let voice_app = app.handle().clone();
                app.listen("voice:invoke", move |event| {
                    let payload = event.payload();
                    handle_voice_invoke(&voice_app, payload);
                });
            }

            // Build system tray icon
            let paused = settings.lock().unwrap().paused;
            let tray_settings = settings.clone();

            let tray_menu = build_tray_menu(app.handle(), paused)?;

            TrayIconBuilder::with_id("main-tray")
                .icon(tauri::include_image!("icons/tray-icon@2x.png"))
                .icon_as_template(true)
                .tooltip("CORE")
                .menu(&tray_menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "toggle_capture" => {
                        let new_paused = {
                            let mut s = tray_settings.lock().unwrap();
                            s.paused = !s.paused;
                            s.paused
                        };
                        save_screen_context_settings(&tray_settings.lock().unwrap());
                        if let Some(tray) = app.tray_by_id("main-tray") {
                            if let Ok(menu) = build_tray_menu(app, new_paused) {
                                let _ = tray.set_menu(Some(menu));
                            }
                        }
                    }
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Prompt the user to set up a local gateway if one isn't configured
            // yet. Delay briefly so the notification doesn't race app launch.
            let notify_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                maybe_notify_gateway_setup(&notify_handle);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
