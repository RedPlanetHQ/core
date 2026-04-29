use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use core_foundation::{
    base::{CFTypeRef, TCFType},
    boolean::CFBoolean,
    dictionary::CFDictionary,
    string::{CFString, CFStringRef},
};
use objc::{class, msg_send, runtime::Object, sel, sel_impl};

use crate::apps;
use crate::ScreenContextSettings;

// ── Accessibility API ─────────────────────────────────────────────────────────

type AXObserverCallback = unsafe extern "C" fn(
    observer: CFTypeRef,
    element:  CFTypeRef,
    notif:    CFStringRef,
    refcon:   *mut c_void,
);

#[link(name = "AppKit", kind = "framework")]
extern "C" {}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(
        element:   CFTypeRef,
        attribute: CFStringRef,
        value:     *mut CFTypeRef,
    ) -> i32;
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
    fn AXObserverCreate(pid: i32, cb: AXObserverCallback, out: *mut CFTypeRef) -> i32;
    fn AXObserverAddNotification(
        observer: CFTypeRef,
        element:  CFTypeRef,
        notif:    CFStringRef,
        refcon:   *mut c_void,
    ) -> i32;
    fn AXObserverGetRunLoopSource(observer: CFTypeRef) -> CFTypeRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: CFTypeRef);
    fn CFGetTypeID(cf: CFTypeRef) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFArrayGetCount(arr: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(arr: CFTypeRef, idx: isize) -> CFTypeRef;
    fn CFRunLoopGetCurrent() -> CFTypeRef;
    fn CFRunLoopAddSource(rl: CFTypeRef, source: CFTypeRef, mode: CFStringRef);
    fn CFRunLoopRemoveSource(rl: CFTypeRef, source: CFTypeRef, mode: CFStringRef);
    fn CFRunLoopRunInMode(mode: CFStringRef, seconds: f64, return_after_handled: bool) -> i32;
    static kCFRunLoopDefaultMode: CFStringRef;
}

unsafe extern "C" fn ax_noop_callback(
    _observer: CFTypeRef,
    _element:  CFTypeRef,
    _notif:    CFStringRef,
    _refcon:   *mut c_void,
) {}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AX_SUCCESS:      i32 = 0;
const AX_API_DISABLED: i32 = -25211;

const SKIP_ROLES:    &[&str] = &["AXSecureTextField"];
const SKIP_SUBROLES: &[&str] = &["AXSecureTextField"];

fn ax_attr(element: CFTypeRef, attr: &str) -> (CFTypeRef, i32) {
    let key = CFString::new(attr);
    let mut value: CFTypeRef = std::ptr::null();
    let err = unsafe {
        AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut value)
    };
    (value, err)
}

fn take_cf_string(cf: CFTypeRef) -> Option<String> {
    if cf.is_null() { return None; }
    unsafe {
        if CFGetTypeID(cf) != CFStringGetTypeID() { CFRelease(cf); return None; }
        let s = core_foundation::string::CFString::wrap_under_get_rule(cf as CFStringRef).to_string();
        CFRelease(cf);
        Some(s)
    }
}

fn read_str(element: CFTypeRef, attr: &str) -> Option<String> {
    let (v, err) = ax_attr(element, attr);
    if err != AX_SUCCESS || v.is_null() { return None; }
    take_cf_string(v)
}

fn collect_text(
    element: CFTypeRef,
    depth:   u32,
    seen:    &mut HashSet<String>,
    out:     &mut String,
) {
    if depth > 25 || out.len() > 8000 { return; }

    let role    = read_str(element, "AXRole").unwrap_or_default();
    let subrole = read_str(element, "AXSubrole").unwrap_or_default();

    if SKIP_ROLES.iter().any(|r| *r == role.as_str())
        || SKIP_SUBROLES.iter().any(|r| *r == subrole.as_str())
    {
        return;
    }

    for attr in &["AXValue", "AXTitle", "AXDescription", "AXHelp"] {
        if let Some(s) = read_str(element, attr) {
            let t = s.trim().to_string();
            if t.len() > 1 && !seen.contains(&t) {
                seen.insert(t.clone());
                out.push_str(&t);
                out.push('\n');
            }
        }
    }

    for child_attr in &["AXChildren", "AXContents", "AXRows", "AXVisibleRows"] {
        let (arr, err) = ax_attr(element, child_attr);
        if err != AX_SUCCESS || arr.is_null() { continue; }
        let count = unsafe { CFArrayGetCount(arr) };
        for i in 0..count {
            let child = unsafe { CFArrayGetValueAtIndex(arr, i) };
            if !child.is_null() { collect_text(child, depth + 1, seen, out); }
            if out.len() > 8000 { break; }
        }
        unsafe { CFRelease(arr) };
        if out.len() > 8000 { break; }
    }
}

// ── Observer ──────────────────────────────────────────────────────────────────

struct AppObserver {
    observer: CFTypeRef,
    app_el:   CFTypeRef,
}

impl AppObserver {
    unsafe fn new(pid: i32) -> Option<Self> {
        let app_el = AXUIElementCreateApplication(pid);
        if app_el.is_null() { return None; }

        let mut observer: CFTypeRef = std::ptr::null();
        let err = AXObserverCreate(pid, ax_noop_callback, &mut observer);
        if err != AX_SUCCESS || observer.is_null() {
            CFRelease(app_el);
            return None;
        }

        for notif in &[
            "AXFocusedUIElementChanged",
            "AXValueChanged",
            "AXChildrenChanged",
        ] {
            let n = CFString::new(notif);
            AXObserverAddNotification(observer, app_el, n.as_concrete_TypeRef(), std::ptr::null_mut());
        }

        let source = AXObserverGetRunLoopSource(observer);
        let rl     = CFRunLoopGetCurrent();
        CFRunLoopAddSource(rl, source, kCFRunLoopDefaultMode);

        Some(AppObserver { observer, app_el })
    }

    unsafe fn pump(&self, seconds: f64) {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, seconds, false);
    }
}

impl Drop for AppObserver {
    fn drop(&mut self) {
        unsafe {
            let source = AXObserverGetRunLoopSource(self.observer);
            let rl     = CFRunLoopGetCurrent();
            CFRunLoopRemoveSource(rl, source, kCFRunLoopDefaultMode);
            CFRelease(self.observer);
            CFRelease(self.app_el);
        }
    }
}

// ── Frontmost app ─────────────────────────────────────────────────────────────

fn get_frontmost_app() -> Option<(i32, String)> {
    unsafe {
        let ws:  *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
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

// ── Permission ────────────────────────────────────────────────────────────────

fn request_permission() -> bool {
    let key = CFString::new("AXTrustedCheckOptionPrompt");
    let val  = CFBoolean::true_value();
    let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), val.as_CFType())]);
    unsafe { AXIsProcessTrustedWithOptions(dict.as_CFTypeRef()) }
}

fn check_permission() -> bool {
    let key = CFString::new("AXTrustedCheckOptionPrompt");
    let val  = CFBoolean::false_value();
    let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), val.as_CFType())]);
    unsafe { AXIsProcessTrustedWithOptions(dict.as_CFTypeRef()) }
}

// ── AX query ──────────────────────────────────────────────────────────────────

/// Snapshot the focused window of `pid`: returns (title, body_text, ax_disabled).
pub fn query(pid: i32) -> (Option<String>, Option<String>, bool) {
    let app_el = unsafe { AXUIElementCreateApplication(pid) };
    if app_el.is_null() { return (None, None, false); }

    let (win, win_err) = ax_attr(app_el, "AXFocusedWindow");
    if win_err == AX_API_DISABLED {
        unsafe { CFRelease(app_el) };
        return (None, None, true);
    }

    let mut title: Option<String> = None;
    let mut text:  Option<String> = None;

    if !win.is_null() {
        title = read_str(win, "AXTitle");
        let mut seen = HashSet::new();
        let mut buf  = String::new();
        collect_text(win, 0, &mut seen, &mut buf);
        if !buf.is_empty() { text = Some(buf); }
        unsafe { CFRelease(win) };
    }

    unsafe { CFRelease(app_el) };
    (title, text, false)
}

fn is_substantive(title: &Option<String>, text: &Option<String>) -> bool {
    match text {
        None => false,
        Some(t) => {
            let lines = t.lines().filter(|l| !l.trim().is_empty()).count();
            let title_len = title.as_deref().unwrap_or("").len();
            lines >= 3 && t.len() > title_len + 150
        }
    }
}

// ── Episode API ───────────────────────────────────────────────────────────────

// Only send if content changed by more than this fraction of words.
const SIMILARITY_THRESHOLD: f64 = 0.85;

/// Jaccard similarity over word sets. Returns 1.0 for identical, 0.0 for disjoint.
fn jaccard_similarity(a: &str, b: &str) -> f64 {
    let words_a: HashSet<&str> = a.split_whitespace().collect();
    let words_b: HashSet<&str> = b.split_whitespace().collect();
    let union = words_a.union(&words_b).count();
    if union == 0 { return 1.0; }
    let intersection = words_a.intersection(&words_b).count();
    intersection as f64 / union as f64
}

fn today_str() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

fn read_api_config() -> Option<(String, String)> {
    let home = std::env::var("HOME").ok()?;
    let path = std::path::PathBuf::from(home)
        .join(".corebrain")
        .join("config.json");
    let content = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let token = json["core"]["auth"]["apiKey"].as_str()?.to_string();
    let url = json["core"]["auth"]["url"].as_str()?.to_string();
    Some((token, url))
}

fn send_episode(app_name: &str, text: &str, session_id: &str) {
    let Some((token, api_url)) = read_api_config() else { return };
    let title = format!("{} - {}", app_name, today_str());

    let body = serde_json::json!({
        "episodeBody": text,
        "referenceTime": chrono::Utc::now().to_rfc3339(),
        "source": "mac",
        "type": "CONVERSATION",
        "sessionId": session_id,
        "title": title,
    });

    let url = format!("{}/api/v1/add", api_url.trim_end_matches('/'));
    if let Err(e) = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .send_json(body)
    {
        log::error!("screen_context: failed to send episode: {}", e);
    }
}

// ── Public entry point ────────────────────────────────────────────────────────

pub fn start_polling(settings: Arc<Mutex<ScreenContextSettings>>) {
    thread::spawn(move || {
        let mut granted = request_permission();
        let mut observed_pid: i32 = -1;
        let mut observer: Option<AppObserver> = None;
        // "{app}-{date}" -> all texts sent that day; skip if too similar to any of them
        let mut sent_today: HashMap<String, Vec<String>> = HashMap::new();
        // session UUID per (app, date) — one session per app per day
        let mut sessions: HashMap<String, String> = HashMap::new();

        loop {
            // Respect pause state
            {
                let s = settings.lock().unwrap();
                if s.paused {
                    drop(s);
                    thread::sleep(Duration::from_secs(5));
                    continue;
                }
            }

            if !granted {
                granted = check_permission();
                if !granted {
                    thread::sleep(Duration::from_secs(5));
                    continue;
                }
            }

            if let Some((pid, app_name)) = get_frontmost_app() {
                // Only capture from explicitly enabled apps (allowlist).
                // Empty enabled_apps = capture nothing.
                {
                    let s = settings.lock().unwrap();
                    if !s.enabled_apps.contains(&app_name) {
                        drop(s);
                        thread::sleep(Duration::from_secs(5));
                        continue;
                    }
                }

                log::info!("[screen_context] capturing accessibility for allowed app: {}", app_name);

                // Manage observer per PID
                if pid != observed_pid {
                    observer     = unsafe { AppObserver::new(pid) };
                    observed_pid = pid;
                    if let Some(ref obs) = observer {
                        unsafe { obs.pump(1.5) };
                    }
                } else if let Some(ref obs) = observer {
                    unsafe { obs.pump(0.1) };
                }

                let (title, text, ax_disabled) = query(pid);

                if ax_disabled {
                    granted = false;
                    continue;
                }

                // Retry if thin
                let (title, text) = if !is_substantive(&title, &text) {
                    if let Some(ref obs) = observer {
                        unsafe { obs.pump(2.0) };
                    }
                    let (t2, tx2, _) = query(pid);
                    (t2, tx2)
                } else {
                    (title, text)
                };

                // Clean using the app-specific cleaner
                let cleaner = apps::get_cleaner(&app_name);
                let cleaned = text
                    .as_deref()
                    .map(|raw| cleaner.clean(raw))
                    .filter(|s| !s.is_empty());

                if let Some(ref text) = cleaned {
                    let today = today_str();
                    let day_key = format!("{}-{}", app_name, today);
                    let already_sent = sent_today.get(&day_key);
                    let too_similar = already_sent.map_or(false, |prev_texts| {
                        prev_texts.iter().any(|prev| jaccard_similarity(prev, text) >= SIMILARITY_THRESHOLD)
                    });
                    if !too_similar {
                        let session_id = sessions
                            .entry(day_key.clone())
                            .or_insert_with(|| uuid::Uuid::new_v4().to_string())
                            .clone();
                        send_episode(&app_name, text, &session_id);
                        sent_today.entry(day_key).or_default().push(text.clone());
                    }
                }
            }

            thread::sleep(Duration::from_secs(5));
        }
    });
}
