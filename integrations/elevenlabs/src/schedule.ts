import { getElevenLabsClient, ElevenLabsConfig } from './utils';

interface ElevenLabsState {
  lastSyncTime?: string;
}

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function createActivity(text: string, sourceURL: string) {
  return {
    type: 'activity',
    data: { text, sourceURL },
  };
}

async function syncHistory(
  config: ElevenLabsConfig,
  lastSyncTime: string
): Promise<ReturnType<typeof createActivity>[]> {
  const activities: ReturnType<typeof createActivity>[] = [];

  try {
    const client = getElevenLabsClient(config.api_key);
    const response = await client.get('/v1/history', {
      params: { page_size: 50 },
    });

    const items: Record<string, unknown>[] = (response.data.history as Record<string, unknown>[]) || [];
    const since = new Date(lastSyncTime).getTime();

    for (const item of items) {
      const dateUnix = typeof item['date_unix'] === 'number' ? (item['date_unix'] as number) * 1000 : 0;
      if (dateUnix < since) continue;

      const voiceName = typeof item['voice_name'] === 'string' ? item['voice_name'] : 'Unknown Voice';
      const modelId = typeof item['model_id'] === 'string' ? item['model_id'] : 'unknown';
      const charCount = typeof item['character_count_change_from'] === 'number' ? item['character_count_change_from'] : 0;
      const historyItemId = typeof item['history_item_id'] === 'string' ? item['history_item_id'] : '';
      const text = typeof item['text'] === 'string' ? item['text'] : '';
      const sourceURL = `https://elevenlabs.io/speech-synthesis`;

      const activityText = `## ElevenLabs TTS Generation\n\n**Voice:** ${voiceName}\n**Model:** ${modelId}\n**Characters used:** ${charCount}\n**Text preview:** ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}\n**History ID:** ${historyItemId}`;

      activities.push(createActivity(activityText, sourceURL));
    }
  } catch (error) {
    console.error('Error syncing ElevenLabs history:', error);
  }

  return activities;
}

async function syncVoices(
  config: ElevenLabsConfig,
  lastSyncTime: string
): Promise<ReturnType<typeof createActivity>[]> {
  const activities: ReturnType<typeof createActivity>[] = [];

  try {
    const client = getElevenLabsClient(config.api_key);
    const response = await client.get('/v1/voices');
    const voices: Record<string, unknown>[] = (response.data.voices as Record<string, unknown>[]) || [];
    const since = new Date(lastSyncTime).getTime();

    for (const voice of voices) {
      const category = typeof voice['category'] === 'string' ? voice['category'] : '';
      if (category !== 'cloned' && category !== 'generated') continue;

      const createdAtUnix = typeof voice['created_at_unix'] === 'number' ? (voice['created_at_unix'] as number) * 1000 : 0;
      if (createdAtUnix > 0 && createdAtUnix < since) continue;

      const voiceName = typeof voice['name'] === 'string' ? voice['name'] : 'Unnamed';
      const voiceId = typeof voice['voice_id'] === 'string' ? voice['voice_id'] : '';
      const description = typeof voice['description'] === 'string' ? voice['description'] : 'N/A';
      const sourceURL = `https://elevenlabs.io/voice-lab`;

      const activityText = `## ElevenLabs Voice: ${voiceName}\n\n**Category:** ${category}\n**Voice ID:** ${voiceId}\n**Description:** ${description}`;

      activities.push(createActivity(activityText, sourceURL));
    }
  } catch (error) {
    console.error('Error syncing ElevenLabs voices:', error);
  }

  return activities;
}

export async function handleSchedule(
  config?: Record<string, string>,
  state?: Record<string, string>
): Promise<unknown[]> {
  try {
    if (!config?.api_key) {
      return [];
    }

    const elevenLabsConfig = config as unknown as ElevenLabsConfig;
    const settings = (state || {}) as ElevenLabsState;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    const messages: unknown[] = [];

    const [historyActivities, voiceActivities] = await Promise.all([
      syncHistory(elevenLabsConfig, lastSyncTime),
      syncVoices(elevenLabsConfig, lastSyncTime),
    ]);

    messages.push(...historyActivities, ...voiceActivities);

    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date().toISOString(),
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in ElevenLabs handleSchedule:', error);
    return [];
  }
}
