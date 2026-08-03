/**
 * Slugify a display name into an @mention-friendly handle.
 * - lowercase
 * - non-alphanumerics collapse to single dashes
 * - strip leading digits and dashes
 * - trim trailing dashes
 * - truncate to maxLen (default 40)
 * - fall back to "agent" if the result would be under 2 chars
 */
export function slugifyHandle(
  name: string,
  opts: { maxLen?: number } = {},
): string {
  const maxLen = opts.maxLen ?? 40;
  const collapsed = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  const withoutLeadingDigits = collapsed.replace(/^[0-9]+-?/, "");
  const truncated = withoutLeadingDigits.slice(0, maxLen).replace(/-+$/, "");
  return truncated.length >= 2 ? truncated : "agent";
}
