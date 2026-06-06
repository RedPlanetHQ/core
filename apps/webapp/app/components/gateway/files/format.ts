/** Humanize a byte count: 1024 → "1.0 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Short relative time: "3m ago", "2h ago", "5d ago". Falls back to a
 * locale date string for older entries.
 */
export function formatRelative(ms: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Full date+time in the user's locale. */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/**
 * Render a Unix mode word as `rwxr-xr-x` plus octal — e.g. `0o755` →
 * "rwxr-xr-x (755)". Ignores the high setuid/setgid/sticky bits for
 * the rwx triplet but keeps them in the octal display.
 */
export function formatMode(mode: number): string {
  const triplet = (bits: number) => {
    const r = bits & 4 ? "r" : "-";
    const w = bits & 2 ? "w" : "-";
    const x = bits & 1 ? "x" : "-";
    return r + w + x;
  };
  const u = triplet((mode >> 6) & 7);
  const g = triplet((mode >> 3) & 7);
  const o = triplet(mode & 7);
  return `${u}${g}${o} (${mode.toString(8).padStart(3, "0")})`;
}
