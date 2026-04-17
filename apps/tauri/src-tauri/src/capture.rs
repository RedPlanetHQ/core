use std::ffi::c_void;
use objc::{class, msg_send, runtime::Object, sel, sel_impl};

// ── CoreGraphics ──────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone)]
struct CGRect {
    origin: CGPoint,
    size:   CGSize,
}
#[repr(C)]
#[derive(Copy, Clone)]
struct CGPoint { x: f64, y: f64 }
#[repr(C)]
#[derive(Copy, Clone)]
struct CGSize  { width: f64, height: f64 }

// CGRectNull — zero rect signals "use window bounds"
fn cg_rect_null() -> CGRect {
    CGRect {
        origin: CGPoint { x: f64::INFINITY, y: f64::INFINITY },
        size:   CGSize  { width: 0.0, height: 0.0 },
    }
}

const CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY:         u32 = 1;
const CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW:       u32 = 8;
const CG_WINDOW_IMAGE_BOUNDS_IGNORE_FRAMING:        u32 = 1;
const CG_WINDOW_IMAGE_NOMINAL_RESOLUTION:           u32 = 4;
const CG_NULL_WINDOW_ID:                            u32 = 0;
const CF_NUMBER_SINT32_TYPE:                        i32 = 9;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// Returns true if screen recording permission is granted.
    pub fn CGPreflightScreenCaptureAccess() -> bool;
    /// Triggers the system prompt for screen recording permission. Returns current state.
    pub fn CGRequestScreenCaptureAccess() -> bool;

    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *const c_void; // CFArrayRef
    fn CGMainDisplayID() -> u32;
    fn CGDisplayCreateImage(display_id: u32) -> *const c_void; // CGImageRef
    fn CGWindowListCreateImageFromArray(
        screen_bounds: CGRect,
        window_array:  *const c_void, // CFArrayRef of CGWindowID (CFNumber)
        image_option:  u32,
    ) -> *const c_void; // CGImageRef
    pub fn CGImageRelease(image: *const c_void);
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(arr: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(arr: *const c_void, idx: isize) -> *const c_void;
    fn CFRelease(cf: *const c_void);
    fn CFDictionaryGetValue(dict: *const c_void, key: *const c_void) -> *const c_void;
    fn CFNumberGetValue(number: *const c_void, the_type: i32, value: *mut c_void) -> bool;
    fn CFNumberCreate(
        allocator: *const c_void,
        the_type:  i32,
        value_ptr: *const c_void,
    ) -> *const c_void;
    fn CFArrayCreateMutable(
        allocator:   *const c_void,
        capacity:    isize,
        callbacks:   *const c_void,
    ) -> *const c_void;
    fn CFArrayAppendValue(arr: *const c_void, value: *const c_void);
}

use core_foundation::{
    base::{CFTypeRef, TCFType},
    string::CFString,
};

fn cf_string_ptr(s: &str) -> *const c_void {
    CFString::new(s).as_concrete_TypeRef() as *const c_void
}

/// Returns the CGWindowIDs of on-screen windows belonging to `pid`.
unsafe fn window_ids_for_pid(pid: i32) -> Option<*const c_void> {
    let window_list = CGWindowListCopyWindowInfo(
        CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY,
        CG_NULL_WINDOW_ID,
    );
    if window_list.is_null() {
        return None;
    }

    let pid_key    = cf_string_ptr("kCGWindowOwnerPID");
    let number_key = cf_string_ptr("kCGWindowNumber");
    let layer_key  = cf_string_ptr("kCGWindowLayer");

    let result_arr = CFArrayCreateMutable(
        std::ptr::null(), 0, std::ptr::null(),
    );

    let count = CFArrayGetCount(window_list);
    for i in 0..count {
        let dict = CFArrayGetValueAtIndex(window_list, i);
        if dict.is_null() { continue; }

        // Only normal windows (layer 0)
        let layer_cf = CFDictionaryGetValue(dict, layer_key);
        if !layer_cf.is_null() {
            let mut layer: i32 = 0;
            CFNumberGetValue(layer_cf, CF_NUMBER_SINT32_TYPE, &mut layer as *mut _ as *mut c_void);
            if layer != 0 { continue; }
        }

        // Match PID
        let pid_cf = CFDictionaryGetValue(dict, pid_key);
        if pid_cf.is_null() { continue; }
        let mut owner_pid: i32 = 0;
        CFNumberGetValue(pid_cf, CF_NUMBER_SINT32_TYPE, &mut owner_pid as *mut _ as *mut c_void);
        if owner_pid != pid { continue; }

        // Get window number and wrap in CFNumber
        let win_cf = CFDictionaryGetValue(dict, number_key);
        if win_cf.is_null() { continue; }
        let mut win_id: i32 = 0;
        CFNumberGetValue(win_cf, CF_NUMBER_SINT32_TYPE, &mut win_id as *mut _ as *mut c_void);

        let win_num = CFNumberCreate(
            std::ptr::null(),
            CF_NUMBER_SINT32_TYPE,
            &win_id as *const _ as *const c_void,
        );
        CFArrayAppendValue(result_arr, win_num);
        CFRelease(win_num);
    }

    CFRelease(window_list);

    let n = CFArrayGetCount(result_arr);
    if n == 0 {
        CFRelease(result_arr);
        return None;
    }

    Some(result_arr)
}

/// Capture the on-screen windows of `pid` into a CGImageRef.
/// Caller must call `CGImageRelease` on the result.
pub unsafe fn capture_pid(pid: i32) -> Option<*const c_void> {
    let ids = window_ids_for_pid(pid)?;

    let image = CGWindowListCreateImageFromArray(
        cg_rect_null(),
        ids,
        CG_WINDOW_IMAGE_BOUNDS_IGNORE_FRAMING | CG_WINDOW_IMAGE_NOMINAL_RESOLUTION,
    );

    CFRelease(ids);

    if image.is_null() { None } else { Some(image) }
}

/// Capture the entire main display. Bypasses window-level content protection
/// (e.g. Slack marks its windows as non-shareable via CGWindowListCreateImage).
/// Caller must call `CGImageRelease` on the result.
pub unsafe fn capture_display() -> Option<*const c_void> {
    let display_id = CGMainDisplayID();
    let image = CGDisplayCreateImage(display_id);
    if image.is_null() { None } else { Some(image) }
}

// ── Vision OCR ────────────────────────────────────────────────────────────────

#[link(name = "Vision", kind = "framework")]
extern "C" {}

/// OCR a CGImageRef using Vision. Returns all recognised text joined by newlines.
pub fn ocr(cg_image: *const c_void) -> String {
    unsafe {
        use std::ffi::CStr;
        use std::os::raw::c_char;

        // VNRecognizeTextRequest — fast mode is plenty accurate for UI text
        let request: *mut Object = msg_send![class!(VNRecognizeTextRequest), new];
        // kVNRequestTextRecognitionLevelFast = 1
        let _: () = msg_send![request, setRecognitionLevel: 1i64];
        // English + any other language
        let _: () = msg_send![request, setUsesLanguageCorrection: true];

        // VNImageRequestHandler
        let options: *mut Object = msg_send![class!(NSDictionary), new];
        let handler: *mut Object = msg_send![class!(VNImageRequestHandler), alloc];
        let handler: *mut Object = msg_send![handler,
            initWithCGImage: cg_image
            options:         options
        ];

        let requests: *mut Object = msg_send![class!(NSArray), arrayWithObject: request];
        let mut err: *mut Object = std::ptr::null_mut();
        let ok: bool = msg_send![handler, performRequests: requests error: &mut err];

        if !ok || !err.is_null() {
            return String::new();
        }

        let observations: *mut Object = msg_send![request, results];
        let count: usize = msg_send![observations, count];
        let mut text = String::new();

        for i in 0..count {
            let obs: *mut Object = msg_send![observations, objectAtIndex: i];
            let candidates: *mut Object = msg_send![obs, topCandidates: 1usize];
            let n: usize = msg_send![candidates, count];
            if n > 0 {
                let cand: *mut Object = msg_send![candidates, objectAtIndex: 0usize];
                let s: *mut Object    = msg_send![cand, string];
                let bytes: *const c_char = msg_send![s, UTF8String];
                if !bytes.is_null() {
                    text.push_str(&CStr::from_ptr(bytes).to_string_lossy());
                    text.push('\n');
                }
            }
        }

        text
    }
}
