/* eslint-disable @typescript-eslint/no-explicit-any */
import { gammaGet } from './utils';

interface GammaSettings {
  lastSyncTime?: string;
}

function createActivityMessage(text: string, sourceURL: string) {
  return {
    type: 'activity',
    data: { text, sourceURL },
  };
}

function getDefaultSyncTime(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString();
}

async function fetchRecentPresentations(apiKey: string, lastSyncTime: string) {
  try {
    const data = await gammaGet('/presentations', apiKey, {
      updatedAfter: lastSyncTime,
      limit: 50,
    });
    return data?.items || data?.presentations || data || [];
  } catch {
    return [];
  }
}

async function fetchRecentDocuments(apiKey: string, lastSyncTime: string) {
  try {
    const data = await gammaGet('/documents', apiKey, {
      updatedAfter: lastSyncTime,
      limit: 50,
    });
    return data?.items || data?.documents || data || [];
  } catch {
    return [];
  }
}

async function fetchRecentWebsites(apiKey: string, lastSyncTime: string) {
  try {
    const data = await gammaGet('/websites', apiKey, {
      updatedAfter: lastSyncTime,
      limit: 50,
    });
    return data?.items || data?.websites || data || [];
  } catch {
    return [];
  }
}

export async function handleSchedule(config: any, state: any) {
  try {
    if (!config?.api_key) {
      return [];
    }

    const settings = (state || {}) as GammaSettings;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    const messages: any[] = [];

    // Fetch and process presentations
    const presentations = await fetchRecentPresentations(config.api_key, lastSyncTime);
    for (const item of presentations) {
      try {
        const title = item.title || item.name || 'Untitled';
        const url = item.url || item.shareUrl || item.publicUrl || '';
        messages.push(createActivityMessage(`Gamma presentation updated: "${title}"`, url));
      } catch {
        // skip malformed items
      }
    }

    // Fetch and process documents
    const documents = await fetchRecentDocuments(config.api_key, lastSyncTime);
    for (const item of documents) {
      try {
        const title = item.title || item.name || 'Untitled';
        const url = item.url || item.shareUrl || item.publicUrl || '';
        messages.push(createActivityMessage(`Gamma document updated: "${title}"`, url));
      } catch {
        // skip malformed items
      }
    }

    // Fetch and process websites
    const websites = await fetchRecentWebsites(config.api_key, lastSyncTime);
    for (const item of websites) {
      try {
        const title = item.title || item.name || 'Untitled';
        const url = item.url || item.shareUrl || item.publicUrl || '';
        messages.push(createActivityMessage(`Gamma website updated: "${title}"`, url));
      } catch {
        // skip malformed items
      }
    }

    // Update state with new sync time
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date().toISOString(),
      },
    });

    return messages;
  } catch {
    return [];
  }
}
