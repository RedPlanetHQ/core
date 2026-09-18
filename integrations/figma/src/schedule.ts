import { createFigmaClient } from './utils';

interface FigmaSettings {
  lastSyncTime?: string;
}

/**
 * Returns a default sync time of 24 hours ago.
 */
function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Scheduled sync handler for the Figma integration.
 *
 * Figma's REST API does not currently expose a "recent activity" feed
 * comparable to GitHub's notifications or Linear's issue feed.
 * Activities are primarily delivered via webhooks (see create-activity.ts).
 *
 * This handler keeps the sync state current so that any future polling
 * logic (e.g. checking file versions) can use a reliable lastSyncTime.
 *
 * TODO: Add polling of file versions / comments for teams that cannot
 *       use webhooks (e.g. Figma Starter plan restrictions).
 */
export async function handleSchedule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state?: Record<string, any>,
): Promise<any[]> {
  try {
    if (!config?.access_token) {
      return [];
    }

    // Verify credentials are still valid by fetching the authenticated user.
    const client = createFigmaClient(config.access_token);
    try {
      await client.get('/v1/me');
    } catch {
      return [];
    }

    const settings = (state ?? {}) as FigmaSettings;
    const _lastSyncTime = settings.lastSyncTime ?? getDefaultSyncTime(); // eslint-disable-line @typescript-eslint/no-unused-vars

    const messages: any[] = [];

    // TODO: Implement polling of file versions / comments here when needed.

    const newSyncTime = new Date().toISOString();
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: newSyncTime,
      },
    });

    return messages;
  } catch {
    return [];
  }
}
