use super::AppCleaner;

/// Generic cleaner used for apps without a dedicated cleaner.
/// Removes empty/short lines and deduplicates consecutive identical lines.
pub struct DefaultCleaner;

impl AppCleaner for DefaultCleaner {
    fn matches(&self, _app_name: &str) -> bool {
        true // fallback — always matches
    }

    fn clean(&self, raw: &str) -> String {
        let mut out: Vec<&str> = raw
            .lines()
            .map(|l| l.trim())
            .filter(|l| l.len() >= 4)
            .collect();

        out.dedup();
        out.join("\n")
    }
}
