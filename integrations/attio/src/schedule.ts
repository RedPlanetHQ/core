/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';

interface AttioSettings {
  lastSyncTime?: string;
}

interface AttioActivityCreateParams {
  text: string;
  sourceURL: string;
}

/**
 * Creates an activity message based on Attio data
 */
function createActivityMessage(params: AttioActivityCreateParams) {
  return {
    type: 'activity',
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

/**
 * Gets default sync time (24 hours ago)
 */
function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fetch recently updated records from Attio
 */
async function fetchRecentRecords(apiKey: string, objectSlug: string, lastSyncTime: string) {
  try {
    const response = await axios.post(
      `https://api.attio.com/v2/objects/${objectSlug}/records/query`,
      {
        filter: {
          updated_at: {
            $gte: lastSyncTime,
          },
        },
        limit: 50,
        sorts: [{ attribute: 'updated_at', direction: 'desc' }],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data?.data || [];
  } catch (_error) {
    return [];
  }
}

/**
 * Fetch recently created notes from Attio
 */
async function fetchRecentNotes(apiKey: string, lastSyncTime: string) {
  try {
    const response = await axios.get('https://api.attio.com/v2/notes', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      params: {
        limit: 50,
        sort: 'created_at:desc',
      },
    });
    const notes = response.data?.data || [];
    return notes.filter(
      (note: any) => note.created_at && new Date(note.created_at) >= new Date(lastSyncTime)
    );
  } catch (_error) {
    return [];
  }
}

/**
 * Process people record activities
 */
async function processPeopleActivities(apiKey: string, lastSyncTime: string): Promise<any[]> {
  const activities = [];
  const records = await fetchRecentRecords(apiKey, 'people', lastSyncTime);

  for (const record of records) {
    try {
      const name =
        record.values?.name?.[0]?.full_name ||
        record.values?.name?.[0]?.first_name ||
        record.id?.record_id ||
        'Unknown Person';

      const email = record.values?.email_addresses?.[0]?.email_address || '';
      const recordId = record.id?.record_id;
      const sourceURL = `https://app.attio.com/people/${recordId}`;

      const text = `Contact updated: ${name}${email ? ` (${email})` : ''}`;

      activities.push(createActivityMessage({ text, sourceURL }));
    } catch (_error) {
      // skip
    }
  }

  return activities;
}

/**
 * Process company record activities
 */
async function processCompanyActivities(apiKey: string, lastSyncTime: string): Promise<any[]> {
  const activities = [];
  const records = await fetchRecentRecords(apiKey, 'companies', lastSyncTime);

  for (const record of records) {
    try {
      const name =
        record.values?.name?.[0]?.value ||
        record.id?.record_id ||
        'Unknown Company';

      const recordId = record.id?.record_id;
      const sourceURL = `https://app.attio.com/companies/${recordId}`;

      const text = `Company updated: ${name}`;

      activities.push(createActivityMessage({ text, sourceURL }));
    } catch (_error) {
      // skip
    }
  }

  return activities;
}

/**
 * Process note activities
 */
async function processNoteActivities(apiKey: string, lastSyncTime: string): Promise<any[]> {
  const activities = [];
  const notes = await fetchRecentNotes(apiKey, lastSyncTime);

  for (const note of notes) {
    try {
      const title = note.title || 'Untitled Note';
      const noteId = note.id?.note_id;
      const parentObjectSlug = note.parent_object;
      const parentRecordId = note.parent_record_id?.record_id;
      const sourceURL =
        parentObjectSlug && parentRecordId
          ? `https://app.attio.com/${parentObjectSlug}/${parentRecordId}`
          : `https://app.attio.com/notes/${noteId}`;

      const text = `Note created: ${title}`;
      activities.push(createActivityMessage({ text, sourceURL }));
    } catch (_error) {
      // skip
    }
  }

  return activities;
}

/**
 * Main function to handle scheduled sync for Attio integration
 */
export async function handleSchedule(config: any, state: any) {
  try {
    if (!config?.api_key) {
      return [];
    }

    const settings = (state || {}) as AttioSettings;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();
    const apiKey: string = config.api_key;

    const messages = [];

    // Process people
    try {
      const personActivities = await processPeopleActivities(apiKey, lastSyncTime);
      messages.push(...personActivities);
    } catch (_error) {
      // ignore
    }

    // Process companies
    try {
      const companyActivities = await processCompanyActivities(apiKey, lastSyncTime);
      messages.push(...companyActivities);
    } catch (_error) {
      // ignore
    }

    // Process notes
    try {
      const noteActivities = await processNoteActivities(apiKey, lastSyncTime);
      messages.push(...noteActivities);
    } catch (_error) {
      // ignore
    }

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
  } catch (_error) {
    return [];
  }
}
