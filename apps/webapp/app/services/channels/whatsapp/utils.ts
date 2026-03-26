/**
 * Canonical daily-conversation title formatter for the WhatsApp channel.
 *
 * Output format: "21st mar'26 whatsapp"
 *   - ordinal day  (1st / 2nd / 3rd / 4th … 11th … 21st …)
 *   - 3-letter lowercase month abbreviation
 *   - apostrophe + 2-digit year
 *   - literal suffix " whatsapp" (lowercase)
 *
 * Dates are evaluated in the user's timezone so the boundary matches
 * what the user sees on their device.
 */

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

/** Returns the ordinal suffix for a calendar day (1-31). */
export function ordinalSuffix(day: number): string {
  // 11th, 12th, 13th are always "-th" regardless of last digit
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Formats a Date into the canonical daily WhatsApp conversation title.
 *
 * @param date - The point in time to format (defaults to now).
 * @param timeZone - The IANA timezone identifier (defaults to system timezone).
 * @returns e.g. "21st mar'26 whatsapp"
 */
export function formatDailyWhatsAppTitle(
  date: Date = new Date(),
  timeZone?: string
): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });

  const parts = fmt.formatToParts(date);
  const day = parseInt(parts.find((p) => p.type === "day")!.value, 10);
  const month = parseInt(parts.find((p) => p.type === "month")!.value, 10);
  const year = parseInt(parts.find((p) => p.type === "year")!.value, 10);

  const suffix = ordinalSuffix(day);
  const monthStr = MONTHS[month - 1];
  const yearStr = String(year).slice(-2);

  return `${day}${suffix} ${monthStr}'${yearStr} whatsapp`;
}
