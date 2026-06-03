//! Server-driven inbox count poller.
//!
//! The original design polled `/api/v1/inbox` from inside the inbox
//! webview's React component. macOS aggressively throttles JavaScript
//! timers in hidden WKWebView windows — once the inbox window has
//! been hidden for a while the `setInterval` stops firing, so new
//! VoiceInboxMessage rows don't surface until the app restarts and
//! the webview mounts fresh.
//!
//! Rust threads are not subject to that throttling, so we move the
//! authoritative count poll here. The poller:
//!
//!   1. Reads the PAT stored via `store_pat` after desktop login.
//!   2. GET {api_base}/api/v1/inbox?limit=1 with Bearer auth.
//!   3. On transition zero → non-zero, shows the inbox panel and
//!      emits `inbox:kick` to the webview so React can refresh its
//!      data (count, items) via the regular cookie-authed fetch.
//!   4. On transition non-zero → zero, hides the panel.
//!
//! The React side keeps a short `inbox:kick` listener that fires an
//! immediate fetch; its own backup setInterval is kept but at a
//! larger period since we no longer depend on it for liveness.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Runtime};

use crate::{inbox_panel, AuthState};

const POLL_INTERVAL_SECS: u64 = 15;
const REQUEST_TIMEOUT_SECS: u64 = 10;
const INBOX_PATH: &str = "/api/v1/inbox?limit=1";

/// Spawn the background poller. Idempotent at the call-site — install
/// exactly once from `setup()`.
pub fn install<R: Runtime>(app: AppHandle<R>, auth: Arc<Mutex<AuthState>>) {
    thread::spawn(move || {
        let url = format!("{}{}", api_base_url(), INBOX_PATH);
        log::info!("[inbox_poller] starting — url={url} interval={POLL_INTERVAL_SECS}s");

        // None until the first successful poll. Used to detect the
        // zero ↔ non-zero edges that drive panel show/hide.
        let mut last_nonzero: Option<bool> = None;

        loop {
            thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));

            // No PAT yet (user hasn't completed desktop login) — keep
            // sleeping. We don't fall back to cookie auth from Rust;
            // the webview owns that path.
            let token = match auth.lock() {
                Ok(guard) => guard.pat.clone(),
                Err(_) => continue,
            };
            let Some(token) = token else { continue };

            match fetch_count(&url, &token) {
                Ok(count) => {
                    let is_nonzero = count > 0;
                    let changed = match last_nonzero {
                        Some(prev) => prev != is_nonzero,
                        None => is_nonzero, // surface non-empty inbox on first read
                    };
                    last_nonzero = Some(is_nonzero);

                    if changed {
                        log::info!(
                            "[inbox_poller] count flipped → count={count} nonzero={is_nonzero}"
                        );
                        // Tell the webview to refetch for fresh items.
                        // Best-effort — failures here aren't fatal,
                        // the next show will paint with whatever the
                        // webview already had.
                        let _ = app.emit("inbox:kick", count);
                        if is_nonzero {
                            inbox_panel::show(&app);
                        } else {
                            inbox_panel::hide(&app);
                        }
                    }
                }
                Err(e) => {
                    // Quiet failure — most likely the user hasn't
                    // logged in yet or the webapp is briefly down.
                    log::debug!("[inbox_poller] fetch failed: {e}");
                }
            }
        }
    });
}

/// Resolve the same base URL the webview uses. In dev we hit the local
/// Remix server; in release we honor `~/.corebrain/config.json`'s
/// `preferences.frontendUrl` if set, else fall back to app.getcore.me.
fn api_base_url() -> String {
    if cfg!(debug_assertions) {
        return "http://localhost:3033".to_string();
    }
    crate::read_frontend_url().unwrap_or_else(|| "https://app.getcore.me".to_string())
}

fn fetch_count(url: &str, token: &str) -> Result<i64, String> {
    let resp = ureq::get(url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/json")
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .call()
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    Ok(json["count"].as_i64().unwrap_or(0))
}
