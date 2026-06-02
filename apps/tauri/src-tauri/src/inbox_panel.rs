//! Inbox pill NSPanel wiring.
//!
//! Sibling of `voice_panel`: same NSPanel mechanics (non-activating,
//! floats across all Spaces, level=ScreenSaver) but for a tiny pill
//! that surfaces unread `VoiceInboxMessage` count from the webapp.
//!
//! The window is declared in lib.rs and points its webview at
//! `/inbox-pill`. That route polls `/api/v1/inbox`, shows itself when
//! count > 0 (via `inbox_show_panel`), and hides itself otherwise (via
//! `inbox_hide_panel`). Click → summarise + voice_speak → hide.
//!
//! Why a separate file from voice_panel: the voice panel hide path
//! also releases the mic — inappropriate for an inbox pill that
//! shouldn't touch audio capture state. Forking keeps each panel's
//! lifecycle exactly what it should be.

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

pub const INBOX_PANEL_LABEL: &str = "inbox";

tauri_panel! {
    panel!(InboxPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            becomes_key_only_if_needed: true,
            is_floating_panel: true
        }
    })
}

/// Convert the `inbox` WebviewWindow into an NSPanel. Idempotent at
/// the call-site level — only invoke once during setup.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window: WebviewWindow<R> = app
        .get_webview_window(INBOX_PANEL_LABEL)
        .ok_or_else(|| format!("inbox window '{INBOX_PANEL_LABEL}' missing"))?;

    window
        .to_panel::<InboxPanel<R>>()
        .map_err(|e| format!("to_panel failed: {e}"))?;

    let panel = app
        .get_webview_panel(INBOX_PANEL_LABEL)
        .map_err(|_| "inbox panel missing from store right after registration".to_string())?;

    let style = StyleMask::empty().borderless().nonactivating_panel();
    panel.set_style_mask(style.value());
    panel.set_level(PanelLevel::ScreenSaver.into());

    let behavior = CollectionBehavior::new()
        .can_join_all_spaces()
        .stationary()
        .full_screen_auxiliary();
    panel.set_collection_behavior(behavior.value());

    panel.set_hides_on_deactivate(false);
    panel.set_has_shadow(false);
    panel.set_transparent(true);

    log::info!(
        "[inbox_panel] installed: level=ScreenSaver style=borderless|nonactivating_panel"
    );

    Ok(())
}

/// Show the inbox pill without taking focus.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(INBOX_PANEL_LABEL) {
        match window.show() {
            Ok(()) => log::info!("[inbox_panel] WebviewWindow.show() ok"),
            Err(e) => log::warn!("[inbox_panel] WebviewWindow.show() failed: {e}"),
        }
    } else {
        log::warn!("[inbox_panel] show: webview window missing");
    }

    match app.get_webview_panel(INBOX_PANEL_LABEL) {
        Ok(panel) => {
            panel.order_front_regardless();
            panel.show();
        }
        Err(_) => log::warn!("[inbox_panel] show: panel not registered yet"),
    }
}

/// Hide the inbox pill. No audio teardown — pure UI hide.
pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(INBOX_PANEL_LABEL) {
        match window.hide() {
            Ok(()) => log::info!("[inbox_panel] WebviewWindow.hide() ok"),
            Err(e) => log::warn!("[inbox_panel] WebviewWindow.hide() failed: {e}"),
        }
    }

    match app.get_webview_panel(INBOX_PANEL_LABEL) {
        Ok(panel) => panel.hide(),
        Err(_) => log::warn!("[inbox_panel] hide: panel not registered yet"),
    }
}

/// Tauri command — React calls this when the polled inbox count flips
/// from zero to non-zero. Resizes / repositions are not needed: the
/// window's geometry is fixed at creation in lib.rs.
#[tauri::command]
pub fn inbox_show_panel<R: Runtime>(app: AppHandle<R>) {
    show(&app);
}

/// Tauri command — React calls this when the polled count hits zero
/// (or right after summarise has been spoken).
#[tauri::command]
pub fn inbox_hide_panel<R: Runtime>(app: AppHandle<R>) {
    hide(&app);
}

/// Promote the panel to key window — same rationale as voice_panel's
/// equivalent: a non-activating panel that isn't key eats the first
/// mouse click. Called by the React side right before the user clicks
/// to summarise.
#[tauri::command]
pub fn inbox_make_panel_key<R: Runtime>(app: AppHandle<R>) {
    match app.get_webview_panel(INBOX_PANEL_LABEL) {
        Ok(panel) => {
            panel.order_front_regardless();
            panel.make_key_window();
        }
        Err(_) => log::warn!("[inbox_panel] make_panel_key: panel not registered"),
    }
}

/// Position the pill at the top-right of the currently active screen.
/// React calls this right before `inbox_show_panel` so the pill never
/// appears in last frame's spot then jumps.
#[tauri::command]
pub fn inbox_position_top_right<R: Runtime>(app: AppHandle<R>) {
    crate::position_inbox_top_right_now(&app);
}
