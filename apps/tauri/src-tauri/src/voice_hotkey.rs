//! Global hotkey: double-tap of Option (alt) within 300ms.
//!
//! Uses NSEvent's `addGlobalMonitorForEventsMatchingMask:handler:` —
//! fires when modifier keys change in any *other* foreground app.
//! Calling install() must happen on the main thread (Tauri's setup()
//! satisfies this).
//!
//! On a clean double-tap we capture the current
//! `NSWorkspace.frontmostApplication.pid` *before* the voice window
//! steals focus, then emit `voice:invoke` with `{ pid, app, screen_frame }`.
//!
//! Limitation (v1): the global monitor does NOT fire while CORE itself
//! is frontmost. Pressing Option+Option from inside the main CORE
//! window won't open the widget. We can add a local monitor in v2 — its
//! handler block returns NSEvent*, which is a different block ABI than
//! the global monitor, so it requires a separately-typed block.

use std::os::raw::c_void;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use block::ConcreteBlock;
use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

// NSEventMask for flagsChanged
// (1 << NSEventTypeFlagsChanged) where NSEventTypeFlagsChanged = 12
const NS_EVENT_MASK_FLAGS_CHANGED: u64 = 1 << 12;

// NSEventModifierFlags raw bits
const NS_EVENT_MODIFIER_FLAG_OPTION: u64 = 1 << 19;
const NS_EVENT_MODIFIER_OTHERS_MASK: u64 = (1 << 16) // CapsLock
    | (1 << 17) // Shift
    | (1 << 18) // Control
    | (1 << 20) // Command
    | (1 << 22) // Help
    | (1 << 23); // Function

const DOUBLE_TAP_WINDOW_MS: u64 = 300;

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
    last_option_up_ms: AtomicU64,
    option_down: AtomicBool,
}

/// Install the global flagsChanged monitor. Must run on the main thread.
pub fn install<R: Runtime>(app: AppHandle<R>) {
    let state = Arc::new(DetectorState {
        last_option_up_ms: AtomicU64::new(0),
        option_down: AtomicBool::new(false),
    });

    let ctx = Box::leak(Box::new(MonitorContext { state, app })) as *mut MonitorContext<R>
        as *mut c_void;

    let block = ConcreteBlock::new(move |event: *mut Object| unsafe {
        handle_flags_changed_event::<R>(event, ctx);
    })
    .copy();

    unsafe {
        let cls = class!(NSEvent);
        let _: *mut Object = msg_send![
            cls,
            addGlobalMonitorForEventsMatchingMask: NS_EVENT_MASK_FLAGS_CHANGED
            handler: &*block
        ];
    }

    // Block must outlive every event delivery — leak it.
    std::mem::forget(block);
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

    let option_down = flags & NS_EVENT_MODIFIER_FLAG_OPTION != 0;
    let foreign_modifier = flags & NS_EVENT_MODIFIER_OTHERS_MASK != 0;

    if foreign_modifier {
        // Any other modifier in flight resets the detector — we only
        // care about clean Option-only down→up→down sequences.
        ctx.state.option_down.store(false, Ordering::SeqCst);
        ctx.state.last_option_up_ms.store(0, Ordering::SeqCst);
        return;
    }

    let now_ms = now_ms();
    let was_down = ctx.state.option_down.load(Ordering::SeqCst);

    if option_down && !was_down {
        // Option pressed down
        let last_up = ctx.state.last_option_up_ms.load(Ordering::SeqCst);
        if last_up != 0 && now_ms.saturating_sub(last_up) <= DOUBLE_TAP_WINDOW_MS {
            // Double-tap detected
            ctx.state.last_option_up_ms.store(0, Ordering::SeqCst);
            ctx.state.option_down.store(true, Ordering::SeqCst);
            fire_invoke(&ctx.app);
            return;
        }
        ctx.state.option_down.store(true, Ordering::SeqCst);
    } else if !option_down && was_down {
        // Option released
        ctx.state.option_down.store(false, Ordering::SeqCst);
        ctx.state.last_option_up_ms.store(now_ms, Ordering::SeqCst);
    }
}

fn now_ms() -> u64 {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(Duration::ZERO);
    dur.as_millis() as u64
}

fn fire_invoke<R: Runtime>(app: &AppHandle<R>) {
    let payload = capture_frontmost();
    let _ = app.emit("voice:invoke", payload);
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

        // Pick the screen under the cursor as the active screen. NSScreen
        // window-containment lookup is heavier (needs CGWindowList); the
        // cursor-screen heuristic is correct for the common single-display
        // case and "right enough" for multi-display.
        let mouse_loc: NSPoint = msg_send![class!(NSEvent), mouseLocation];
        let main_screen: *mut Object = msg_send![class!(NSScreen), mainScreen];
        let mut frame = ns_rect_of(main_screen);

        let screens: *mut Object = msg_send![class!(NSScreen), screens];
        if !screens.is_null() {
            let count: usize = msg_send![screens, count];
            for i in 0..count {
                let scr: *mut Object = msg_send![screens, objectAtIndex: i];
                let f = ns_rect_of(scr);
                if mouse_loc.x >= f.x
                    && mouse_loc.x <= f.x + f.width
                    && mouse_loc.y >= f.y
                    && mouse_loc.y <= f.y + f.height
                {
                    frame = f;
                    break;
                }
            }
        }

        VoiceInvokePayload {
            pid,
            app: name,
            screen_frame: frame,
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
struct NSPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct NSRect {
    origin: NSPoint,
    size: NSSize,
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
