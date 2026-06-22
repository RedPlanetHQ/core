//! Scratchpad HUD: bottom-left corner pill + expanded panel.
//!
//! Two NSPanels, both bottom-left of the currently active screen:
//!   - `scratchpad-pill` — tiny ~160x44 affordance that appears when the
//!     cursor approaches the bottom-left corner of any screen. Clicking
//!     it opens the HUD.
//!   - `scratchpad-hud`  — ~400x600 webview rendering today's scratchpad
//!     (chromeless, cookie-authed like the inbox pill).
//!
//! Built on the same NSPanel mechanics as `voice_panel` and
//! `inbox_panel`: non-activating, all-Spaces, level=ScreenSaver. They
//! never steal focus from the user's frontmost app.
//!
//! Cursor-driven show/hide for the pill is handled by
//! `start_cursor_corner_poll` below — a background thread polling
//! `NSEvent.mouseLocation` every 150 ms and emitting:
//!   - `scratchpad:corner-enter` when the cursor enters a 100×100
//!     bottom-left zone of the active screen
//!   - `scratchpad:corner-leave` when it exits a 260×260 zone
//! Hysteresis (different in vs out zones) prevents the pill from
//! flickering when the user grazes the corner.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, LogicalPosition, Manager, Runtime, WebviewWindow};
use tauri_nspanel::{
    CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

pub const SCRATCHPAD_PILL_LABEL: &str = "scratchpad-pill";
pub const SCRATCHPAD_HUD_LABEL: &str = "scratchpad-hud";

// Panel geometry — kept in sync with the `inner_size` calls in lib.rs.
const PILL_W: f64 = 240.0;
const PILL_H: f64 = 300.0;
const HUD_W: f64 = 400.0;
const HUD_H: f64 = 600.0;
// Tight gap from the screen edge. The corner-trigger is already an
// Apple-Hot-Corners-style hot zone, so the launcher itself can sit
// flush — a thin gap reads as "anchored to the corner" instead of
// "floating near it".
const EDGE_INSET: f64 = 8.0;

// Corner-trigger geometry — matches the Apple Hot Corners model:
// the cursor has to *reach the actual screen corner* (within a few
// pixels of both edges) before the launcher appears. That's both
// precise (a casual cursor pass through the area won't trigger) and
// safe (app windows don't extend to the screen corner, so the trigger
// doesn't compete with any clickable UI).
//
//   - ENTER:  cursor within HOT_CORNER_PX of both the left and bottom
//             screen edges
//   - LEAVE:  cursor more than LEAVE_X / LEAVE_Y from the corner
//             (well beyond the launcher's own footprint, so moving the
//             cursor onto the launcher itself doesn't dismiss it)
const HOT_CORNER_PX: f64 = 6.0;
const CORNER_LEAVE_X: f64 = 320.0;
const CORNER_LEAVE_Y: f64 = 340.0;

// The tauri_panel! macro emits a wide set of `use` statements at module
// scope (objc2, AppKit types, etc.). Calling it twice in the same
// module creates duplicate-import errors, so each panel definition is
// isolated in its own private sub-module. We re-export the generated
// panel types so the rest of this module can use them with their plain
// names.
mod pill_panel {
    // The macro expansion references `app_handle()` and other helpers
    // that live on the `Manager` trait; bring it (and the rest of the
    // tauri / tauri_nspanel surface the expansion needs) into scope.
    #[allow(unused_imports)]
    use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
    use tauri_nspanel::tauri_panel;
    tauri_panel! {
        panel!(ScratchpadPillPanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                becomes_key_only_if_needed: true,
                is_floating_panel: true
            }
        })
    }
}

mod hud_panel {
    #[allow(unused_imports)]
    use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
    use tauri_nspanel::tauri_panel;
    tauri_panel! {
        panel!(ScratchpadHudPanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                becomes_key_only_if_needed: true,
                is_floating_panel: true
            }
        })
    }
}

use pill_panel::ScratchpadPillPanel;
use hud_panel::ScratchpadHudPanel;

// ── Install ──────────────────────────────────────────────────────────────────

/// Convert the `scratchpad-pill` WebviewWindow into an NSPanel.
pub fn install_pill<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window: WebviewWindow<R> = app
        .get_webview_window(SCRATCHPAD_PILL_LABEL)
        .ok_or_else(|| format!("scratchpad window '{SCRATCHPAD_PILL_LABEL}' missing"))?;
    window
        .to_panel::<ScratchpadPillPanel<R>>()
        .map_err(|e| format!("to_panel({SCRATCHPAD_PILL_LABEL}) failed: {e}"))?;
    apply_panel_chrome(app, SCRATCHPAD_PILL_LABEL)
}

/// Convert the `scratchpad-hud` WebviewWindow into an NSPanel.
pub fn install_hud<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window: WebviewWindow<R> = app
        .get_webview_window(SCRATCHPAD_HUD_LABEL)
        .ok_or_else(|| format!("scratchpad window '{SCRATCHPAD_HUD_LABEL}' missing"))?;
    window
        .to_panel::<ScratchpadHudPanel<R>>()
        .map_err(|e| format!("to_panel({SCRATCHPAD_HUD_LABEL}) failed: {e}"))?;
    apply_panel_chrome(app, SCRATCHPAD_HUD_LABEL)
}

fn apply_panel_chrome<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    let panel = app
        .get_webview_panel(label)
        .map_err(|_| format!("scratchpad panel '{label}' missing from store"))?;

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
        "[scratchpad_panel] installed '{label}': level=ScreenSaver style=borderless|nonactivating_panel"
    );
    Ok(())
}

// ── show / hide ───────────────────────────────────────────────────────────────

fn show_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    // Re-apply the all-Spaces collection behavior on every show.
    // macOS has been observed to drop `canJoinAllSpaces` /
    // `stationary` flags on some Space transitions (Mission Control
    // sweep, new Space creation, fullscreen-app crossing), leaving
    // the panel pinned to whichever Space it was last visible in.
    // Re-setting before each show is cheap and idempotent — and
    // turns "sometimes follows" into "always follows".
    if let Ok(panel) = app.get_webview_panel(label) {
        let behavior = CollectionBehavior::new()
            .can_join_all_spaces()
            .stationary()
            .full_screen_auxiliary();
        panel.set_collection_behavior(behavior.value());
        panel.set_level(PanelLevel::ScreenSaver.into());
    }

    if let Some(window) = app.get_webview_window(label) {
        if let Err(e) = window.show() {
            log::warn!("[scratchpad_panel] {label} WebviewWindow.show() failed: {e}");
        }
    } else {
        log::warn!("[scratchpad_panel] show: '{label}' webview window missing");
    }
    match app.get_webview_panel(label) {
        Ok(panel) => {
            panel.order_front_regardless();
            panel.show();
        }
        Err(_) => log::warn!("[scratchpad_panel] show: '{label}' panel not registered yet"),
    }
}

fn hide_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        if let Err(e) = window.hide() {
            log::warn!("[scratchpad_panel] {label} WebviewWindow.hide() failed: {e}");
        }
    }
    match app.get_webview_panel(label) {
        Ok(panel) => panel.hide(),
        Err(_) => log::warn!("[scratchpad_panel] hide: '{label}' panel not registered yet"),
    }
}

pub fn pill_show<R: Runtime>(app: &AppHandle<R>) {
    position_bottom_left::<R>(app, SCRATCHPAD_PILL_LABEL, PILL_H);
    show_window(app, SCRATCHPAD_PILL_LABEL);
}

pub fn pill_hide<R: Runtime>(app: &AppHandle<R>) {
    hide_window(app, SCRATCHPAD_PILL_LABEL);
}

pub fn hud_show<R: Runtime>(app: &AppHandle<R>) {
    position_bottom_left::<R>(app, SCRATCHPAD_HUD_LABEL, HUD_H);
    show_window(app, SCRATCHPAD_HUD_LABEL);
    // Tell the pill webview the HUD is up so it can suppress its glow
    // (no point hinting toward a corner already occupied by the HUD).
    if let Err(e) = app.emit("scratchpad-hud:shown", ()) {
        log::warn!("[scratchpad_panel] scratchpad-hud:shown emit failed: {e}");
    }
}

pub fn hud_hide<R: Runtime>(app: &AppHandle<R>) {
    hide_window(app, SCRATCHPAD_HUD_LABEL);
    // Signal the pill that the corner is free again — it re-evaluates
    // whether to show the glow (if there are still unread messages).
    if let Err(e) = app.emit("scratchpad-hud:hidden", ()) {
        log::warn!("[scratchpad_panel] scratchpad-hud:hidden emit failed: {e}");
    }
}

// ── Positioning ───────────────────────────────────────────────────────────────

fn position_bottom_left<R: Runtime>(app: &AppHandle<R>, label: &str, win_h: f64) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let frame = crate::voice_hotkey::current_active_screen_frame();
    // Tauri's LogicalPosition matches the convention used by
    // voice_panel / inbox_panel here: pass logical points derived from
    // the NSScreen frame directly.
    let target_x = frame.x + EDGE_INSET;
    let target_y = frame.y + frame.height - win_h - EDGE_INSET;
    if let Err(e) = window.set_position(LogicalPosition::new(target_x, target_y)) {
        log::warn!("[scratchpad_panel] {label} set_position failed: {e}");
    }
}

pub fn reposition_for_active_screen<R: Runtime>(app: &AppHandle<R>) {
    if let Some(pill) = app.get_webview_window(SCRATCHPAD_PILL_LABEL) {
        if pill.is_visible().unwrap_or(false) {
            position_bottom_left::<R>(app, SCRATCHPAD_PILL_LABEL, PILL_H);
        }
    }
    if let Some(hud) = app.get_webview_window(SCRATCHPAD_HUD_LABEL) {
        if hud.is_visible().unwrap_or(false) {
            position_bottom_left::<R>(app, SCRATCHPAD_HUD_LABEL, HUD_H);
        }
    }
    // Width is fixed at creation in lib.rs; positioning helper takes
    // only the height it needs to flip the y axis. Suppress unused-var
    // warnings for the unused width constants when this module is
    // compiled without consumers reading them via reflection.
    let _ = PILL_W;
    let _ = HUD_W;
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn scratchpad_pill_show<R: Runtime>(app: AppHandle<R>) {
    pill_show(&app);
}

#[tauri::command]
pub fn scratchpad_pill_hide<R: Runtime>(app: AppHandle<R>) {
    pill_hide(&app);
}

#[tauri::command]
pub fn scratchpad_hud_show<R: Runtime>(app: AppHandle<R>) {
    // Opening the HUD also dismisses the pill — they share the same
    // screen real estate and the user is committing to the larger view.
    pill_hide(&app);
    hud_show(&app);
}

#[tauri::command]
pub fn scratchpad_hud_hide<R: Runtime>(app: AppHandle<R>) {
    hud_hide(&app);
}

/// Same rationale as voice/inbox `make_panel_key`: a non-activating
/// panel that isn't key eats the first mouse click on its UI.
#[tauri::command]
pub fn scratchpad_hud_make_panel_key<R: Runtime>(app: AppHandle<R>) {
    if let Ok(panel) = app.get_webview_panel(SCRATCHPAD_HUD_LABEL) {
        panel.order_front_regardless();
        panel.make_key_window();
    }
}

#[tauri::command]
pub fn scratchpad_pill_make_panel_key<R: Runtime>(app: AppHandle<R>) {
    if let Ok(panel) = app.get_webview_panel(SCRATCHPAD_PILL_LABEL) {
        panel.order_front_regardless();
        panel.make_key_window();
    }
}

/// Toggle whether the pill window passes mouse events through to whatever
/// app is underneath. We set this to `true` while the pill is rendering
/// only the corner "you have messages" glow (purely decorative, must not
/// intercept clicks), and `false` once the launcher card is on screen.
#[tauri::command]
pub fn scratchpad_pill_set_clickthrough<R: Runtime>(app: AppHandle<R>, ignore: bool) {
    if let Some(window) = app.get_webview_window(SCRATCHPAD_PILL_LABEL) {
        if let Err(e) = window.set_ignore_cursor_events(ignore) {
            log::warn!(
                "[scratchpad_panel] set_ignore_cursor_events({ignore}) failed: {e}"
            );
        }
    }
}

// ── Cursor corner-poll thread ────────────────────────────────────────────────

/// Read the global mouse location in Cocoa screen coordinates
/// (y-up, origin at the bottom-left of the primary screen).
fn read_mouse_location() -> (f64, f64) {
    // The tauri_panel! macro brings AppKit's NSEvent into scope inside
    // its sub-modules, but not here — so we use the classic `objc`
    // dynamic dispatch (matching voice_hotkey.rs / screen_context.rs).
    use objc::{class, msg_send, sel, sel_impl};

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct MousePoint {
        x: f64,
        y: f64,
    }

    unsafe {
        let p: MousePoint = msg_send![class!(NSEvent), mouseLocation];
        (p.x, p.y)
    }
}

/// Spawn the background thread that watches the cursor and emits the
/// corner-enter / corner-leave events the pill listens for.
pub fn start_cursor_corner_poll<R: Runtime>(app: AppHandle<R>) {
    let near = Arc::new(AtomicBool::new(false));

    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(150));

            // If the HUD is up, silence corner pulses entirely — the
            // user is committed to the larger view and the pill is
            // hidden. (The pill re-arms cleanly when the HUD closes.)
            if let Some(hud) = app.get_webview_window(SCRATCHPAD_HUD_LABEL) {
                if hud.is_visible().unwrap_or(false) {
                    near.store(false, Ordering::SeqCst);
                    continue;
                }
            }

            let (mx, my) = read_mouse_location();
            let screen = crate::voice_hotkey::current_active_screen_frame();

            // Cocoa screen coordinates: y is up, origin at bottom-left
            // of the screen the mouse is on.
            let dx = (mx - screen.x).max(0.0);
            let dy = (my - screen.y).max(0.0);

            let was_near = near.load(Ordering::SeqCst);
            // ENTER: cursor parked at the very corner — both axes must
            // be within HOT_CORNER_PX of the screen edges.
            let at_hot_corner = dx <= HOT_CORNER_PX && dy <= HOT_CORNER_PX;
            // LEAVE: cursor has moved off both the corner and the
            // launcher's footprint.
            let still_near_launcher = dx <= CORNER_LEAVE_X && dy <= CORNER_LEAVE_Y;

            if !was_near && at_hot_corner {
                near.store(true, Ordering::SeqCst);
                if let Err(e) = app.emit("scratchpad:corner-enter", ()) {
                    log::warn!("[scratchpad_panel] corner-enter emit failed: {e}");
                }
            } else if was_near && !still_near_launcher {
                near.store(false, Ordering::SeqCst);
                if let Err(e) = app.emit("scratchpad:corner-leave", ()) {
                    log::warn!("[scratchpad_panel] corner-leave emit failed: {e}");
                }
            }
        }
    });
}
