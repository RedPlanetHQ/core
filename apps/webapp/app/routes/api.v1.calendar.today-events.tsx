import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { IntegrationLoader } from "~/utils/mcp/integration-loader";
import { executeIntegrationAction } from "~/utils/mcp/integration-operations";

const SearchParamsSchema = z.object({
  timezone: z.string().optional().default("UTC"),
});

function getTodayBounds(timezone: string): { timeMin: string; timeMax: string } {
  const now = new Date();

  // Get today's date string in the requested timezone (YYYY-MM-DD)
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Get the UTC offset for this timezone at the start of today
  const startOfDay = new Date(`${dateStr}T00:00:00`);
  const endOfDay = new Date(`${dateStr}T23:59:59`);

  // Convert local midnight/end-of-day to UTC ISO strings using the timezone offset
  const offsetMs = getTimezoneOffsetMs(timezone, startOfDay);
  const timeMin = new Date(startOfDay.getTime() - offsetMs).toISOString();
  const timeMax = new Date(endOfDay.getTime() - offsetMs).toISOString();

  return { timeMin, timeMax };
}

function getTimezoneOffsetMs(timezone: string, date: Date): number {
  // Compute the UTC offset in milliseconds for a given timezone at a given date
  const utcDate = new Date(
    date.toLocaleString("en-US", { timeZone: "UTC" }),
  );
  const localDate = new Date(
    date.toLocaleString("en-US", { timeZone: timezone }),
  );
  return utcDate.getTime() - localDate.getTime();
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  htmlLink?: string;
  allDay: boolean;
}

const loader = createHybridLoaderApiRoute(
  {
    searchParams: SearchParamsSchema,
    allowJWT: true,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ searchParams, authentication }) => {
    const { timezone } = searchParams;
    const userId = authentication.userId;
    const workspaceId = authentication.workspaceId as string | undefined;

    // If the user isn't associated with a workspace (or we're missing it),
    // treat as "not connected" so the widget can render an empty state.
    if (!workspaceId) {
      return json({ events: [] as CalendarEvent[], connected: false });
    }

    // If integration lookup fails for any reason, do not throw—allow empty state.
    let accounts: Awaited<
      ReturnType<typeof IntegrationLoader.getConnectedIntegrationAccounts>
    > = [];
    try {
      accounts = await IntegrationLoader.getConnectedIntegrationAccounts(
        userId,
        workspaceId,
        ["google-calendar"],
      );
    } catch {
      return json({ events: [] as CalendarEvent[], connected: false });
    }

    if (accounts.length === 0) {
      return json({ events: [] as CalendarEvent[], connected: false });
    }

    const account = accounts[0];
    const { timeMin, timeMax } = getTodayBounds(timezone);

    let rawEvents: any[] = [];
    try {
      const result = await executeIntegrationAction(
        account.id,
        "list_events",
        {
          calendarId: "primary",
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 50,
        },
        userId,
      );

      const text = (result as any)?.content?.[0]?.text;
      if (text) {
        rawEvents = JSON.parse(text);
      }
    } catch {
      return json({ events: [] as CalendarEvent[], connected: true, error: true });
    }

    const events: CalendarEvent[] = rawEvents.map((e: any) => ({
      id: e.id ?? "",
      summary: e.summary ?? "(No title)",
      start: e.start ?? {},
      end: e.end ?? {},
      location: e.location,
      htmlLink: e.htmlLink,
      allDay: !!e.start?.date && !e.start?.dateTime,
    }));

    return json({ events, connected: true, error: false });
  },
);

export { loader };
