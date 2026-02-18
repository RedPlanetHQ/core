import { getLinkedInData } from './utils';

interface LinkedInSettings {
  lastSyncTime?: string;
  id?: string;
}

/**
 * Creates an activity message based on LinkedIn data
 */
function createActivityMessage(text: string, sourceURL: string) {
  return {
    type: 'activity',
    data: {
      text,
      sourceURL,
    },
  };
}

/**
 * Gets default sync time (24 hours ago)
 */
function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

export async function handleSchedule(
  config?: Record<string, string>,
  state?: Record<string, string>,
) {
  try {
    const accessToken = config?.access_token;

    if (!accessToken) {
      return [];
    }

    let settings = (state || {}) as LinkedInSettings;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    // Fetch user info if not in settings
    if (!settings.id) {
      try {
        const user = await getLinkedInData('https://api.linkedin.com/v2/me', accessToken);
        settings.id = user.id;
      } catch (error) {
        return [];
      }
    }

    const messages = [];

    // Placeholder for fetching activities. 
    // LinkedIn API is very restricted for fetching historical activity without special permissions.
    // In a real scenario, we might try to fetch shares if the account has permissions.
    
    // Example: Fetching shares (often requires r_member_social or similar)
    /*
    try {
      const urn = `urn:li:person:${settings.id}`;
      const shares = await getLinkedInData(
        `https://api.linkedin.com/v2/shares?q=owners&owners=${urn}&sharesPerOwner=10`,
        accessToken
      );
      // Process shares...
    } catch (e) {}
    */

    // Update last sync time
    const newSyncTime = new Date().toISOString();

    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: newSyncTime,
      },
    });

    return messages;
  } catch (error) {
    return [];
  }
}
