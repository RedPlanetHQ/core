//! Voice-widget NSPanel wiring.
//!
//! The `voice` window declared in tauri.conf.json is a regular Tauri
//! WebviewWindow — under the hood, an NSWindow. We swizzle its class
//! to NSPanel via `tauri-nspanel` so it behaves like Clicky's floating
//! companion panel: non-activating (clicking it doesn't steal focus
//! from the user's app), present on every Space (including fullscreen
//! Spaces), and pinned above ordinary windows.
//!
//! Why an NSPanel instead of a tweaked NSWindow:
//!   - NSPanel.becomesKeyOnlyIfNeeded keeps the user's previous app
//!     focused while the widget receives keystrokes for our React UI.
//!   - The non-activating style mask is the only reliable way to stop
//!     macOS from yanking focus when the widget is shown.
//!   - On macOS 26 (Tahoe), the older "raw NSWindow with collection
//!     behavior tweaks" path became flaky — NSPanel is the documented
//!     route Apple still honors.

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

use crate::speech;

pub const VOICE_PANEL_LABEL: &str = "voice";

tauri_panel! {
    panel!(VoicePanel {
        config: {
            // Lets the React widget receive keystrokes (Esc, typing).
            can_become_key_window: true,
            // Don't let it become "main" — that's reserved for the CORE app window.
            can_become_main_window: false,
            // Only become key when an inner control actually needs focus,
            // so we don't steal focus on every show.
            becomes_key_only_if_needed: true,
            // Floats above ordinary windows.
            is_floating_panel: true
        }
    })
}

/// Convert the `voice` WebviewWindow declared in tauri.conf.json into an NSPanel.
/// Idempotent at the call-site level — only invoke once during setup.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window: WebviewWindow<R> = app
        .get_webview_window(VOICE_PANEL_LABEL)
        .ok_or_else(|| format!("voice window '{VOICE_PANEL_LABEL}' missing in tauri.conf.json"))?;

    // Swizzle NSWindow → VoicePanel and register the handle in the
    // plugin's panel store.
    window
        .to_panel::<VoicePanel<R>>()
        .map_err(|e| format!("to_panel failed: {e}"))?;

    let panel = app
        .get_webview_panel(VOICE_PANEL_LABEL)
        .map_err(|_| "panel missing from store right after registration".to_string())?;

    // Borderless + non-activating. Keep the WKWebView as the contentView,
    // strip the title-bar chrome the StyleMask::new() default would add.
    let style = StyleMask::empty().borderless().nonactivating_panel();
    panel.set_style_mask(style.value());

    // Floating panels render at level 4 (above normal windows). For an
    // overlay that should beat fullscreen apps too, .ScreenSaver (1000)
    // is the level Clicky and most "always-visible HUD" Mac apps use.
    panel.set_level(PanelLevel::ScreenSaver.into());

    // - canJoinAllSpaces:    appears on every virtual desktop
    // - stationary:          doesn't follow the user when Spaces switch
    //                        (combined with canJoinAllSpaces this means
    //                        "render here on every Space, don't migrate")
    // - fullScreenAuxiliary: also visible above fullscreen-app Spaces
    let behavior = CollectionBehavior::new()
        .can_join_all_spaces()
        .stationary()
        .full_screen_auxiliary();
    panel.set_collection_behavior(behavior.value());

    // Defensive: a non-activating panel that hides when the user clicks
    // away would defeat the whole "stay visible while talking" design.
    panel.set_hides_on_deactivate(false);
    panel.set_has_shadow(false);
    panel.set_transparent(true);

    log::info!(
        "[voice_panel] installed: level=ScreenSaver(1000) style=borderless|nonactivating_panel \
         behavior=canJoinAllSpaces|stationary|fullScreenAuxiliary"
    );

    Ok(())
}

/// Show the voice panel without taking focus. The Tauri window-level
/// `window.show()` call ends up routing through the swizzled NSPanel,
/// but going through the panel handle gives us the order-front-regardless
/// semantics we want (no activation, no app switch).
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    match app.get_webview_panel(VOICE_PANEL_LABEL) {
        Ok(panel) => {
            panel.order_front_regardless();
            panel.show();
        }
        Err(_) => log::warn!("[voice_panel] show: panel not registered yet"),
    }
}

/// Hide the panel. Safe to call even if it isn't visible.
///
/// Always releases the mic + cancels any in-flight TTS first — otherwise
/// macOS's mic-in-use indicator (orange dot) sticks around forever
/// because the SFSpeechRecognizer task and audio engine in the Swift
/// helper outlive the panel that triggered them. The next Ctrl-Option
/// hold's `voice_start_listening` re-arms cleanly.
///
/// Belt-and-suspenders: we call BOTH the swizzled NSPanel hide AND the
/// underlying WebviewWindow's hide. Either one alone has been
/// observed to no-op on high-level panels (`NSScreenSaverWindowLevel` +
/// `canJoinAllSpaces`) on certain macOS versions.
pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    speech::release_audio(app);

    if let Some(window) = app.get_webview_window(VOICE_PANEL_LABEL) {
        match window.hide() {
            Ok(()) => log::info!("[voice_panel] WebviewWindow.hide() ok"),
            Err(e) => log::warn!("[voice_panel] WebviewWindow.hide() failed: {e}"),
        }
        match window.is_visible() {
            Ok(v) => log::info!("[voice_panel] post-hide is_visible={v}"),
            Err(e) => log::warn!("[voice_panel] is_visible() failed: {e}"),
        }
    } else {
        log::warn!("[voice_panel] hide: webview window missing");
    }

    match app.get_webview_panel(VOICE_PANEL_LABEL) {
        Ok(panel) => {
            panel.hide();
            log::info!("[voice_panel] panel.hide() called");
        }
        Err(_) => log::warn!("[voice_panel] hide: panel not registered yet"),
    }
}

/// Tauri command — exposed so the React widget can ask for an
/// NSPanel-correct hide (Tauri's `getCurrentWindow().hide()` from JS
/// doesn't always route through the swizzled NSPanel hide path).
#[tauri::command]
pub fn voice_hide_panel<R: Runtime>(app: AppHandle<R>) {
    log::info!("[voice_panel] voice_hide_panel command");
    hide(&app);
}

/// Promote the panel to key window without activating the CORE app.
/// Needed when the user expands the pill into the chat box: a
/// non-activating panel that isn't key eats the first mouse click on
/// any button (the click is consumed becoming-key), so the close X
/// would need two clicks to register. Calling `make_key_window` once
/// the user has clearly committed to interacting (i.e. expanded the
/// panel) lets every subsequent click land on its target on the first
/// try, while orderFrontRegardless preserves the non-activating
/// "user's previous app stays in front" property.
#[tauri::command]
pub fn voice_make_panel_key<R: Runtime>(app: AppHandle<R>) {
    match app.get_webview_panel(VOICE_PANEL_LABEL) {
        Ok(panel) => {
            panel.order_front_regardless();
            panel.make_key_window();
            log::info!("[voice_panel] panel promoted to key");
        }
        Err(_) => log::warn!("[voice_panel] make_panel_key: panel not registered"),
    }
}
