//! Global hotkey: hold Ctrl+Option to talk to butler (push-to-talk).
//!
//! Uses NSEvent's `addGlobalMonitorForEventsMatchingMask:handler:` —
//! fires when modifier keys change in any *other* foreground app.
//! Calling install() must happen on the main thread (Tauri's setup()
//! satisfies this).
//!
//! When the user presses Ctrl+Option (and *only* those modifiers — no
//! Cmd/Shift/Function/CapsLock), we capture the frontmost-app context
//! and emit `voice:invoke`. When the chord drops (either key released
//! OR a foreign modifier joins) we emit `voice:hold-end`. The widget
//! uses the two events to drive a hold-to-talk lifecycle.
//!
//! We install both a global monitor (events delivered to *other* apps)
//! and a local monitor (events delivered to CORE itself), so the same
//! chord works regardless of whether CORE is frontmost. The local
//! monitor returns the event back to AppKit unchanged so it still
//! dispatches normally.

use std::os::raw::c_void;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use block::ConcreteBlock;
use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

const DOUBLE_TAP_WINDOW_MS: u64 = 300;

// NSEventMask for flagsChanged
// (1 << NSEventTypeFlagsChanged) where NSEventTypeFlagsChanged = 12
const NS_EVENT_MASK_FLAGS_CHANGED: u64 = 1 << 12;

// NSEventModifierFlags raw bits
const NS_EVENT_MODIFIER_FLAG_CONTROL: u64 = 1 << 18;
const NS_EVENT_MODIFIER_FLAG_OPTION: u64 = 1 << 19;
const NS_EVENT_MODIFIER_FOREIGN_MASK: u64 = (1 << 16) // CapsLock
    | (1 << 17) // Shift
    | (1 << 20) // Command
    | (1 << 22) // Help
    | (1 << 23); // Function

#[derive(Serialize, Clone)]
pub struct VoiceInvokePayload {
    pub pid: i32,
    pub app: String,
    pub screen_frame: ScreenFrame,
}

#[derive(Serialize, Clone, Copy)]
pub struct ScreenFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

struct DetectorState {
    /// Are Ctrl+Option both currently held (with no foreign modifiers)?
    is_holding: AtomicBool,
    /// Is Ctrl currently held? (independent of other modifiers)
    ctrl_held: AtomicBool,
    /// During the current ctrl-held period, was Option ever pressed?
    /// Set true when Option arrives while Ctrl is down — used to
    /// disqualify the ctrl-up that follows from double-tap detection.
    option_seen_during_ctrl: AtomicBool,
    /// Timestamp of the last clean ctrl-only release (no foreign mods,
    /// no Option ever joined). 0 = never / disqualified.
    last_clean_ctrl_up_ms: AtomicU64,
}

/// Install the global flagsChanged monitor. Must run on the main thread.
pub fn install<R: Runtime>(app: AppHandle<R>) {
    log::info!("[voice_hotkey] installing global flagsChanged monitor (hold Ctrl+Option)");
    log_ax_status();

    let state = Arc::new(DetectorState {
        is_holding: AtomicBool::new(false),
        ctrl_held: AtomicBool::new(false),
        option_seen_during_ctrl: AtomicBool::new(false),
        last_clean_ctrl_up_ms: AtomicU64::new(0),
    });

    let ctx = Box::leak(Box::new(MonitorContext { state, app })) as *mut MonitorContext<R>
        as *mut c_void;

    let block = ConcreteBlock::new(move |event: *mut Object| unsafe {
        handle_flags_changed_event::<R>(event, ctx);
    })
    .copy();

    let token: *mut Object = unsafe {
        let cls = class!(NSEvent);
        msg_send![
            cls,
            addGlobalMonitorForEventsMatchingMask: NS_EVENT_MASK_FLAGS_CHANGED
            handler: &*block
        ]
    };

    log::info!(
        "[voice_hotkey] global monitor token = {:?} (null = AX permission missing or install failed)",
        token
    );

    // Block must outlive every event delivery — leak it.
    std::mem::forget(block);

    // Local monitor — fires for events delivered to CORE itself, which
    // the global monitor never sees. The block must return the event
    // (or nil to swallow); we always pass it through so AppKit
    // dispatches as normal.
    let block_local = ConcreteBlock::new(move |event: *mut Object| -> *mut Object {
        unsafe { handle_flags_changed_event::<R>(event, ctx) };
        event
    })
    .copy();

    let local_token: *mut Object = unsafe {
        let cls = class!(NSEvent);
        msg_send![
            cls,
            addLocalMonitorForEventsMatchingMask: NS_EVENT_MASK_FLAGS_CHANGED
            handler: &*block_local
        ]
    };

    log::info!("[voice_hotkey] local monitor token = {:?}", local_token);
    std::mem::forget(block_local);
}

fn log_ax_status() {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;

    extern "C" {
        fn AXIsProcessTrustedWithOptions(
            options: core_foundation::base::CFTypeRef,
        ) -> bool;
    }
    let key = CFString::new("AXTrustedCheckOptionPrompt");
    let val = CFBoolean::false_value();
    let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), val.as_CFType())]);
    let trusted = unsafe { AXIsProcessTrustedWithOptions(dict.as_CFTypeRef()) };
    log::info!(
        "[voice_hotkey] accessibility trusted = {} (global monitors require AX permission)",
        trusted
    );
}

struct MonitorContext<R: Runtime> {
    state: Arc<DetectorState>,
    app: AppHandle<R>,
}

unsafe fn handle_flags_changed_event<R: Runtime>(
    event: *mut Object,
    ctx_ptr: *mut c_void,
) {
    if event.is_null() || ctx_ptr.is_null() {
        return;
    }
    let ctx = &*(ctx_ptr as *const MonitorContext<R>);
    let flags: u64 = msg_send![event, modifierFlags];

    let control_down = flags & NS_EVENT_MODIFIER_FLAG_CONTROL != 0;
    let option_down = flags & NS_EVENT_MODIFIER_FLAG_OPTION != 0;
    let foreign = flags & NS_EVENT_MODIFIER_FOREIGN_MASK != 0;

    // ── Hold-Ctrl+Option chord (push-to-talk) ─────────────────────────
    let chord_held = control_down && option_down && !foreign;
    let was_holding = ctx.state.is_holding.load(Ordering::SeqCst);
    if chord_held && !was_holding {
        ctx.state.is_holding.store(true, Ordering::SeqCst);
        log::info!("[voice_hotkey] HOLD start (Ctrl+Option) — emitting voice:invoke");
        fire_event(&ctx.app, "voice:invoke", capture_frontmost());
    } else if !chord_held && was_holding {
        ctx.state.is_holding.store(false, Ordering::SeqCst);
        log::info!("[voice_hotkey] HOLD end — emitting voice:hold-end");
        fire_event(&ctx.app, "voice:hold-end", ());
    }

    // ── Double-tap Ctrl (open expanded panel, no listening) ───────────
    let ctrl_was = ctx.state.ctrl_held.load(Ordering::SeqCst);
    if control_down && !ctrl_was {
        // Ctrl just pressed
        ctx.state.ctrl_held.store(true, Ordering::SeqCst);
        // If Option is already down at the moment of press, this isn't a
        // clean ctrl-only sequence — note that for the upcoming up.
        ctx.state
            .option_seen_during_ctrl
            .store(option_down || foreign, Ordering::SeqCst);

        // Double-tap check: only trigger when this press is clean
        // (no Option, no foreign).
        if !option_down && !foreign {
            let last_up = ctx.state.last_clean_ctrl_up_ms.load(Ordering::SeqCst);
            let now_ms = now_ms();
            let dt = now_ms.saturating_sub(last_up);
            if last_up != 0 && dt <= DOUBLE_TAP_WINDOW_MS {
                ctx.state.last_clean_ctrl_up_ms.store(0, Ordering::SeqCst);
                log::info!(
                    "[voice_hotkey] DOUBLE-TAP Ctrl — emitting voice:invoke-expand"
                );
                fire_event(&ctx.app, "voice:invoke-expand", capture_frontmost());
            }
        }
    } else if !control_down && ctrl_was {
        // Ctrl released
        ctx.state.ctrl_held.store(false, Ordering::SeqCst);
        let dirty = ctx.state.option_seen_during_ctrl.load(Ordering::SeqCst);
        if dirty {
            // Disqualified — Option (or another modifier) joined during
            // this ctrl-down period.
            ctx.state.last_clean_ctrl_up_ms.store(0, Ordering::SeqCst);
        } else {
            ctx.state
                .last_clean_ctrl_up_ms
                .store(now_ms(), Ordering::SeqCst);
        }
    } else if control_down && (option_down || foreign) {
        // Option (or another mod) arrived during a ctrl-down period.
        ctx.state
            .option_seen_during_ctrl
            .store(true, Ordering::SeqCst);
    }
}

fn now_ms() -> u64 {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(Duration::ZERO);
    dur.as_millis() as u64
}

fn fire_event<R: Runtime, P: serde::Serialize + Clone>(
    app: &AppHandle<R>,
    name: &str,
    payload: P,
) {
    if let Err(e) = app.emit(name, payload) {
        log::error!("[voice_hotkey] {name} emit failed: {e}");
    }
}

fn capture_frontmost() -> VoiceInvokePayload {
    unsafe {
        let ws: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let app: *mut Object = msg_send![ws, frontmostApplication];

        let mut pid: i32 = -1;
        let mut name = String::new();

        if !app.is_null() {
            pid = msg_send![app, processIdentifier];
            let name_obj: *mut Object = msg_send![app, localizedName];
            if !name_obj.is_null() {
                let bytes: *const std::os::raw::c_char = msg_send![name_obj, UTF8String];
                if !bytes.is_null() {
                    name = std::ffi::CStr::from_ptr(bytes)
                        .to_string_lossy()
                        .into_owned();
                }
            }
        }

        let frame = active_screen_frame();

        VoiceInvokePayload {
            pid,
            app: name,
            screen_frame: frame,
        }
    }
}

/// Resolve "the screen the user is on right now."
///
/// Tried strategies, in order:
///   1. The screen containing `NSEvent.mouseLocation` — most reliable
///      across multi-display setups regardless of "Displays have separate
///      Spaces" being on.
///   2. `NSScreen.mainScreen` — works only when separate-spaces is on.
///   3. The first entry of `NSScreen.screens` as a last resort.
unsafe fn active_screen_frame() -> ScreenFrame {
    let main_screen: *mut Object = msg_send![class!(NSScreen), mainScreen];
    let mut frame = ns_rect_of(main_screen);

    let mouse: NSPoint = msg_send![class!(NSEvent), mouseLocation];
    let screens: *mut Object = msg_send![class!(NSScreen), screens];
    if !screens.is_null() {
        let count: usize = msg_send![screens, count];
        for i in 0..count {
            let scr: *mut Object = msg_send![screens, objectAtIndex: i];
            let f = ns_rect_of(scr);
            if mouse.x >= f.x
                && mouse.x <= f.x + f.width
                && mouse.y >= f.y
                && mouse.y <= f.y + f.height
            {
                frame = f;
                log::debug!(
                    "[voice_hotkey] mouse at ({},{}) → screen ({},{} {}x{})",
                    mouse.x,
                    mouse.y,
                    f.x,
                    f.y,
                    f.width,
                    f.height
                );
                return frame;
            }
        }
    }
    log::debug!(
        "[voice_hotkey] no screen contained mouse — falling back to mainScreen ({},{} {}x{})",
        frame.x,
        frame.y,
        frame.width,
        frame.height
    );
    frame
}

// ── Live screen-following ─────────────────────────────────────────────────────

/// Subscribe to NSWorkspace activation notifications so the voice
/// widget can reposition itself when the user switches to an app on a
/// different screen. Emits `voice:active-screen-changed` with the new
/// `ScreenFrame`. lib.rs decides whether to reposition (only when the
/// voice window is visible).
pub fn install_screen_follower<R: Runtime>(app: AppHandle<R>) {
    log::info!("[voice_hotkey] installing NSWorkspace activation observer");

    let app = std::sync::Mutex::new(app);
    let app_arc = std::sync::Arc::new(app);

    let block_app = app_arc.clone();
    let block = ConcreteBlock::new(move |_notif: *mut Object| {
        let frame = unsafe { active_screen_frame() };
        if let Ok(app) = block_app.lock() {
            log::info!(
                "[voice_hotkey] active app changed → screen ({},{} {}x{})",
                frame.x,
                frame.y,
                frame.width,
                frame.height
            );
            let _ = app.emit("voice:active-screen-changed", frame);
        }
    })
    .copy();

    unsafe {
        let ws: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let nc: *mut Object = msg_send![ws, notificationCenter];
        let name = objc_string("NSWorkspaceDidActivateApplicationNotification");
        let _: *mut Object = msg_send![
            nc,
            addObserverForName: name
            object: std::ptr::null::<Object>()
            queue: std::ptr::null::<Object>()
            usingBlock: &*block
        ];
    }

    std::mem::forget(block);
}

unsafe fn objc_string(s: &str) -> *mut Object {
    let cls = class!(NSString);
    let cstr = std::ffi::CString::new(s).unwrap();
    msg_send![cls, stringWithUTF8String: cstr.as_ptr()]
}

#[repr(C)]
#[derive(Copy, Clone)]
struct NSRect {
    origin: NSPoint,
    size: NSSize,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct NSPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct NSSize {
    width: f64,
    height: f64,
}

unsafe fn ns_rect_of(screen: *mut Object) -> ScreenFrame {
    if screen.is_null() {
        return ScreenFrame {
            x: 0.0,
            y: 0.0,
            width: 1440.0,
            height: 900.0,
        };
    }
    let r: NSRect = msg_send![screen, frame];
    ScreenFrame {
        x: r.origin.x,
        y: r.origin.y,
        width: r.size.width,
        height: r.size.height,
    }
}
