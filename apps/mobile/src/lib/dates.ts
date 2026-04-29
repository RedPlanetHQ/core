// Mirrors apps/webapp/app/components/daily/daily-page.client.tsx — start with
// "today + 3 days ahead", then prepend past days as the user scrolls up.

export const INITIAL_AFTER = 3;
export const LOAD_MORE = 7;
export const MAX_DATES = 30;

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function buildInitialDates(today: Date): Date[] {
  return Array.from({ length: INITIAL_AFTER + 1 }, (_, i) => addDays(today, i));
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatDateHeader(date: Date): string {
  const dow = WEEKDAYS[date.getDay()];
  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  const suffix = ordinalSuffix(day);
  return `${dow}, ${month} ${day}${suffix}, ${date.getFullYear()}`;
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
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
