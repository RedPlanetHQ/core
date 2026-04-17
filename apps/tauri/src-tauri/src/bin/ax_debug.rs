/// Run with Slack (or any app) as frontmost:
///   cargo run --bin ax_debug > tree.txt 2>&1
///
/// Then open tree.txt to see the full AX tree with roles + text at every node.

use core_foundation::{
    base::{CFTypeRef, TCFType},
    boolean::CFBoolean,
    dictionary::CFDictionary,
    string::{CFString, CFStringRef},
};
use objc::{class, msg_send, runtime::Object, sel, sel_impl};

#[link(name = "AppKit", kind = "framework")]
extern "C" {}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(
        element: CFTypeRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXUIElementCopyAttributeNames(element: CFTypeRef, names: *mut CFTypeRef) -> i32;
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: CFTypeRef);
    fn CFGetTypeID(cf: CFTypeRef) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFArrayGetCount(arr: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(arr: CFTypeRef, idx: isize) -> CFTypeRef;
}

fn ax_attr(element: CFTypeRef, attr: &str) -> (CFTypeRef, i32) {
    let key = CFString::new(attr);
    let mut value: CFTypeRef = std::ptr::null();
    let err = unsafe {
        AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut value)
    };
    (value, err)
}

fn take_cf_string(cf: CFTypeRef) -> Option<String> {
    if cf.is_null() {
        return None;
    }
    unsafe {
        if CFGetTypeID(cf) != CFStringGetTypeID() {
            CFRelease(cf);
            return None;
        }
        let s = CFString::wrap_under_get_rule(cf as CFStringRef).to_string();
        CFRelease(cf);
        Some(s)
    }
}

/// For Get-rule CF strings (e.g. items inside a CFArray we own) — don't release.
fn take_cf_string_no_release(cf: CFTypeRef) -> Option<String> {
    if cf.is_null() { return None; }
    unsafe {
        if CFGetTypeID(cf) != CFStringGetTypeID() { return None; }
        Some(CFString::wrap_under_get_rule(cf as CFStringRef).to_string())
    }
}

fn read_str(element: CFTypeRef, attr: &str) -> Option<String> {
    let (v, err) = ax_attr(element, attr);
    if err != 0 || v.is_null() {
        return None;
    }
    take_cf_string(v)
}

fn dump(element: CFTypeRef, depth: usize, max_depth: usize) {
    if depth > max_depth {
        let indent = "  ".repeat(depth);
        println!("{}[max depth reached]", indent);
        return;
    }

    let indent = "  ".repeat(depth);
    let role    = read_str(element, "AXRole").unwrap_or_else(|| "?".into());
    let subrole = read_str(element, "AXSubrole").unwrap_or_default();
    let title   = read_str(element, "AXTitle").unwrap_or_default();
    let value   = read_str(element, "AXValue").unwrap_or_default();
    let desc    = read_str(element, "AXDescription").unwrap_or_default();
    let help    = read_str(element, "AXHelp").unwrap_or_default();

    // Print this node
    let mut parts = vec![format!("[{}]", role)];
    if !subrole.is_empty() { parts.push(format!("sub={}", subrole)); }
    if !title.is_empty()   { parts.push(format!("title={:?}", truncate(&title, 80))); }
    if !value.is_empty()   { parts.push(format!("value={:?}", truncate(&value, 80))); }
    if !desc.is_empty()    { parts.push(format!("desc={:?}", truncate(&desc, 80))); }
    if !help.is_empty()    { parts.push(format!("help={:?}", truncate(&help, 80))); }

    println!("{}{}", indent, parts.join(" "));

    // On leaf nodes (no AXChildren), dump every attribute's actual value
    {
        let (arr, err) = ax_attr(element, "AXChildren");
        let has_children = err == 0 && !arr.is_null() && unsafe { CFArrayGetCount(arr) } > 0;
        if !arr.is_null() { unsafe { CFRelease(arr) }; }

        if !has_children {
            let mut names_ref: CFTypeRef = std::ptr::null();
            let err = unsafe { AXUIElementCopyAttributeNames(element, &mut names_ref) };
            if err == 0 && !names_ref.is_null() {
                let count = unsafe { CFArrayGetCount(names_ref) };
                let mut attr_names = Vec::new();
                for i in 0..count {
                    let name_cf = unsafe { CFArrayGetValueAtIndex(names_ref, i) };
                    if let Some(s) = take_cf_string_no_release(name_cf) {
                        attr_names.push(s);
                    }
                }
                unsafe { CFRelease(names_ref) };

                // Print the actual value of each attribute
                for attr_name in &attr_names {
                    // Skip structural/positional attrs — we care about text
                    if matches!(attr_name.as_str(),
                        "AXParent" | "AXWindow" | "AXTopLevelUIElement" |
                        "AXTitleUIElement" | "AXFocusableAncestor" |
                        "AXPosition" | "AXSize" | "AXFrame") {
                        continue;
                    }
                    if let Some(v) = read_str(element, attr_name) {
                        if !v.is_empty() {
                            println!("{}  {}: {:?}", indent, attr_name, truncate(&v, 300));
                        }
                    }
                }
            }
        }
    }

    // Recurse through all child-collection attributes
    for child_attr in &["AXChildren", "AXContents", "AXRows", "AXVisibleRows"] {
        let (arr, err) = ax_attr(element, child_attr);
        if err != 0 || arr.is_null() {
            continue;
        }
        let count = unsafe { CFArrayGetCount(arr) };
        if count == 0 {
            unsafe { CFRelease(arr) };
            continue;
        }
        // Only print the attribute label if it differs from AXChildren
        if *child_attr != "AXChildren" {
            println!("{}  <via {}>", indent, child_attr);
        }
        for i in 0..count {
            let child = unsafe { CFArrayGetValueAtIndex(arr, i) };
            if !child.is_null() {
                dump(child, depth + 1, max_depth);
            }
        }
        unsafe { CFRelease(arr) };
    }
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() > max {
        &s[..max]
    } else {
        s
    }
}

fn get_frontmost() -> Option<(i32, String)> {
    unsafe {
        let ws: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let app: *mut Object = msg_send![ws, frontmostApplication];
        if app.is_null() { return None; }
        let pid: i32 = msg_send![app, processIdentifier];
        let name_obj: *mut Object = msg_send![app, localizedName];
        if name_obj.is_null() { return None; }
        let bytes: *const std::os::raw::c_char = msg_send![name_obj, UTF8String];
        if bytes.is_null() { return None; }
        let name = std::ffi::CStr::from_ptr(bytes).to_string_lossy().into_owned();
        Some((pid, name))
    }
}

fn ensure_permission() -> bool {
    let key = CFString::new("AXTrustedCheckOptionPrompt");
    let val = CFBoolean::true_value();
    let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), val.as_CFType())]);
    unsafe { AXIsProcessTrustedWithOptions(dict.as_CFTypeRef()) }
}

fn main() {
    if !ensure_permission() {
        eprintln!("Accessibility permission not granted. Enable in System Settings → Accessibility.");
        std::process::exit(1);
    }

    // Small sleep so you have time to switch to the target app before we read
    eprintln!("Waiting 3s — switch to the app you want to inspect...");
    std::thread::sleep(std::time::Duration::from_secs(3));

    let (pid, name) = get_frontmost().expect("no frontmost app");
    eprintln!("Inspecting: {} (pid {})", name, pid);

    let app_el = unsafe { AXUIElementCreateApplication(pid) };
    assert!(!app_el.is_null(), "AXUIElementCreateApplication returned null");

    // Dump the focused window (or full app if no focused window)
    let (win, _) = ax_attr(app_el, "AXFocusedWindow");
    let root = if !win.is_null() { win } else { app_el };

    dump(root, 0, 40);

    if !win.is_null() { unsafe { CFRelease(win) }; }
    unsafe { CFRelease(app_el) };
}
