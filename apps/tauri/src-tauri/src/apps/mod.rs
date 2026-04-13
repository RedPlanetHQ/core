mod default;
mod slack;

pub use default::DefaultCleaner;
pub use slack::SlackCleaner;

/// Trait that each app-specific cleaner must implement.
/// Add a new file under `apps/` and register it in `get_cleaner` below.
pub trait AppCleaner: Send + Sync {
    /// Returns true if this cleaner handles the given app name.
    fn matches(&self, app_name: &str) -> bool;

    /// Cleans the raw AX text and returns structured content.
    /// The default implementation just trims lines and removes empties.
    fn clean(&self, raw: &str) -> String {
        raw.lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

static CLEANERS: &[&(dyn AppCleaner + Sync)] = &[
    &SlackCleaner,
    // Register new app cleaners here:
    // &VsCodeCleaner,
    // &ChromeCleaner,
];

static DEFAULT_CLEANER: DefaultCleaner = DefaultCleaner;

/// Returns the best cleaner for the given app name.
pub fn get_cleaner(app_name: &str) -> &'static dyn AppCleaner {
    CLEANERS
        .iter()
        .find(|c| c.matches(app_name))
        .copied()
        .unwrap_or(&DEFAULT_CLEANER)
}
