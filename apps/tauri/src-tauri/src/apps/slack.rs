use super::AppCleaner;

pub struct SlackCleaner;

impl AppCleaner for SlackCleaner {
    fn matches(&self, app_name: &str) -> bool {
        app_name == "Slack"
    }

    fn clean(&self, raw: &str) -> String {
        let mut main_msgs: Vec<String> = Vec::new();
        let mut thread_msgs: Vec<String> = Vec::new();
        let mut in_thread = false;

        for line in raw.lines() {
            let l = line.trim();
            if l.is_empty() {
                continue;
            }

            // Detect the thread panel — everything after this is a thread.
            if l.starts_with("Thread in ") {
                in_thread = true;
                continue;
            }

            if let Some(msg) = extract_message(l) {
                if in_thread {
                    thread_msgs.push(msg);
                } else {
                    main_msgs.push(msg);
                }
            }
        }

        let mut out = String::new();

        if !main_msgs.is_empty() {
            main_msgs.dedup();
            out.push_str(&main_msgs.join("\n"));
        }

        if !thread_msgs.is_empty() {
            thread_msgs.dedup();
            if !out.is_empty() {
                out.push_str("\n\n[Thread]\n");
            }
            out.push_str(&thread_msgs.join("\n"));
        }

        out
    }
}

// ── Message extraction ────────────────────────────────────────────────────────

/// Tries to parse `l` as "Author: body [trailing metadata]".
/// Returns `"Author: cleaned_body"` on success.
fn extract_message(l: &str) -> Option<String> {
    let colon = l.find(": ")?;
    let name = l[..colon].trim();
    if !looks_like_name(name) {
        return None;
    }
    let body = strip_trailing_metadata(&l[colon + 2..]);
    if body.is_empty() {
        return None;
    }
    Some(format!("{}: {}", name, body))
}

/// Returns true if `name` looks like a human or bot display name.
/// Rejects things like "@CORE (APP)", channel headers, etc.
fn looks_like_name(name: &str) -> bool {
    let n = name.trim();
    n.len() >= 2
        && n.len() <= 50
        && !n.starts_with('@')
        && !n.contains('(')
        && !n.contains(')')
        && !n.contains('#')
        && n.chars()
            .all(|c| c.is_alphabetic() || c == ' ' || c == '-' || c == '\'' || c == '.')
}

// ── Trailing metadata stripping ───────────────────────────────────────────────

/// Returns true for tokens that are trailing metadata appended by Slack to AX text:
///   - wall-clock times: "23:15", "9:05"
///   - "Today at HH:MM" / "Yesterday at HH:MM"
///   - reply/link/attachment counts: "2 replies", "1 link", "1 reply, 2 attachments"
///   - edited notices: "Edited Today at 00:22"
///   - "Last reply …"
fn is_metadata_suffix(s: &str) -> bool {
    let s = s.trim_end_matches('.');
    if is_time_like(s) {
        return true;
    }
    for prefix in &["Today at ", "Yesterday at "] {
        if let Some(rest) = s.strip_prefix(prefix) {
            if is_time_like(rest.trim_end_matches('.')) {
                return true;
            }
        }
    }
    if s.starts_with("Edited ") || s.starts_with("Last reply") {
        return true;
    }
    // "N word" or "N word, N word" — reply / link / attachment counts
    let first = s.split(|c: char| c == ' ' || c == ',').next().unwrap_or("");
    if first.parse::<u32>().is_ok() {
        let lower = s.to_ascii_lowercase();
        if lower.contains("repl") || lower.contains("link") || lower.contains("attachment") {
            return true;
        }
    }
    false
}

/// Returns true if `s` looks like a wall-clock time, e.g. "18:18" or "9:05".
fn is_time_like(s: &str) -> bool {
    let s = s.trim_end_matches('.');
    let mut it = s.splitn(2, ':');
    let h = it.next().unwrap_or("");
    let m = it.next().unwrap_or("");
    !h.is_empty()
        && h.len() <= 2
        && h.chars().all(|c| c.is_ascii_digit())
        && m.len() == 2
        && m.chars().all(|c| c.is_ascii_digit())
}

/// Strips Slack's trailing metadata from a message body.
///
/// Slack appends things like ". 23:15. 2 replies. Edited Today at 00:22" to the AX
/// text of attributed messages. This function removes those suffixes so the agent
/// only sees the actual message content.
fn strip_trailing_metadata(s: &str) -> String {
    let mut result = s.trim().to_string();

    // Phase 1: iteratively strip ". {metadata}" from the right.
    loop {
        let r = result.trim_end_matches('.').trim().to_string();
        match r.rfind(". ") {
            Some(pos) if is_metadata_suffix(&r[pos + 2..]) => {
                result = r[..pos].to_string();
            }
            _ => {
                result = r;
                break;
            }
        }
    }

    // Phase 2: strip a trailing space-separated timestamp (" HH:MM") that has no
    // leading dot (happens when the message body ends with "?" or similar punctuation).
    let trimmed = result.trim_end_matches('.').trim().to_string();
    if let Some(pos) = trimmed.rfind(' ') {
        let suffix = trimmed[pos + 1..].trim_end_matches('.');
        if is_time_like(suffix) {
            result = trimmed[..pos].trim_end_matches('.').trim().to_string();
        } else {
            result = trimmed;
        }
    } else {
        result = trimmed;
    }

    result
}
