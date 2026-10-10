import { createActivityFromEvent, createActivityFromMonitor } from './create-activity';
import {
  createDatadogClient,
  extractConfig,
  fetchAllEventsSince,
  fetchMonitors,
  getBaseUrl,
} from './utils';

interface DatadogState {
  lastEventTimestamp?: number;
  lastMonitorSync?: string;
}

const DEFAULT_LOOKBACK_SECONDS = 24 * 60 * 60; // 24 hours

export async function handleSchedule(config: Record<string, unknown>, state: unknown) {
  const { api_key, app_key, region } = extractConfig(config);

  if (!api_key || !app_key) {
    return [];
  }

  const settings = (state || {}) as DatadogState;
  const now = Math.floor(Date.now() / 1000);
  const lastEventTimestamp = settings.lastEventTimestamp ?? now - DEFAULT_LOOKBACK_SECONDS;

  const client = createDatadogClient(api_key, app_key, region);
  const baseUrl = getBaseUrl(region);

  const messages: Array<{ type: string; data: unknown }> = [];

  // --- Monitors: surface non-OK monitors ---
  try {
    const monitors = await fetchMonitors(client);
    for (const monitor of monitors) {
      const activity = createActivityFromMonitor(monitor, baseUrl);
      if (activity) {
        messages.push(activity);
      }
    }
  } catch {
    // Non-fatal; continue to events
  }

  // --- Events: incremental sync since last run ---
  try {
    const events = await fetchAllEventsSince(client, lastEventTimestamp);
    // Events come newest-first from Datadog; process them all
    for (const event of events) {
      const activity = createActivityFromEvent(event);
      if (activity) {
        messages.push(activity);
      }
    }
  } catch {
    // Non-fatal
  }

  // Persist state
  messages.push({
    type: 'state',
    data: {
      ...settings,
      lastEventTimestamp: now,
      lastMonitorSync: new Date().toISOString(),
    },
  });

  return messages;
}
