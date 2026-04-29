import { api } from "./api";

export type Page = {
  id: string;
  date: string | null;
  description?: string | null;
  title?: string | null;
};

// Server normalizes the date to UTC midnight, so YYYY-MM-DD is enough.
export async function getPageForDate(date: Date): Promise<Page> {
  const iso = formatYmd(date);
  return api<Page>(`/api/v1/page?date=${iso}`, { method: "GET" });
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
