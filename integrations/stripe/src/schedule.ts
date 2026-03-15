import { createActivity } from './create-activity';
import { getPaginatedStripeEvents } from './utils';

interface StripeSettings {
  lastEventId?: string;
  lastSyncTime?: string;
}

export async function handleSchedule(config: Record<string, unknown>, state: unknown) {
  const accessToken = config?.access_token as string | undefined;

  if (!accessToken) {
    return [];
  }

  const settings = (state || {}) as StripeSettings;

  // Default to 30 days ago (Stripe retains events for 30 days)
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const createdGte = settings.lastSyncTime
    ? Math.floor(new Date(settings.lastSyncTime).getTime() / 1000)
    : thirtyDaysAgo;

  const messages = [];
  let startingAfter: string | undefined = undefined;
  let hasMore = true;
  let newestEventId: string | undefined = undefined;
  const allEvents = [];

  // Paginate through all new events
  while (hasMore) {
    try {
      const result = await getPaginatedStripeEvents(accessToken, startingAfter, createdGte);

      allEvents.push(...result.events);

      // Track the newest event ID (first event in first page)
      if (!newestEventId && result.lastEventId) {
        newestEventId = result.lastEventId;
      }

      hasMore = result.hasMore;

      if (result.events.length > 0) {
        startingAfter = result.events[result.events.length - 1].id;
      } else {
        hasMore = false;
      }
    } catch {
      hasMore = false;
    }
  }

  // Skip events we've already processed (by lastEventId)
  const newEvents = settings.lastEventId
    ? allEvents.filter((e) => {
        // Events are sorted newest first; skip any we've seen
        return e.id !== settings.lastEventId && e.created >= createdGte;
      })
    : allEvents;

  // Convert events to activities
  for (const event of newEvents) {
    const activity = createActivity(event);
    if (activity) {
      messages.push(activity);
    }
  }

  // Save state with newest event ID and sync time
  messages.push({
    type: 'state',
    data: {
      ...settings,
      lastEventId: newestEventId || settings.lastEventId,
      lastSyncTime: new Date().toISOString(),
    },
  });

  return messages;
}
