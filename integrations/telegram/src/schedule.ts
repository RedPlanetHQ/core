import { callTelegramApi, formatUser, formatChat } from './utils';

interface TelegramSettings {
  lastSyncTime?: string;
  lastUpdateId?: number;
  trackedChatIds?: string[];
  botId?: string;
}

interface ActivityCreateParams {
  text: string;
  sourceURL: string;
}

function createActivityMessage(params: ActivityCreateParams) {
  return {
    type: 'activity',
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Process updates from the Telegram Bot API using getUpdates (long polling)
 */
async function processUpdates(
  botToken: string,
  lastUpdateId: number
): Promise<{ activities: any[]; newLastUpdateId: number }> {
  const activities = [];
  let newLastUpdateId = lastUpdateId;

  try {
    const updates = await callTelegramApi(botToken, 'getUpdates', {
      offset: lastUpdateId + 1,
      limit: 100,
      timeout: 0,
      allowed_updates: ['message', 'channel_post'],
    });

    for (const update of updates) {
      if (update.update_id > newLastUpdateId) {
        newLastUpdateId = update.update_id;
      }

      const message = update.message || update.channel_post;
      if (!message) continue;

      const from = message.from ? formatUser(message.from) : 'Unknown';
      const chat = formatChat(message.chat);
      const chatType = message.chat.type;
      const text = message.text || message.caption || '[media]';
      const timestamp = new Date(message.date * 1000).toLocaleString();

      const chatId = message.chat.id;
      const messageId = message.message_id;

      const sourceURL = chatType === 'private'
        ? `https://t.me/c/${chatId}/${messageId}`
        : `https://t.me/c/${String(chatId).replace('-100', '')}/${messageId}`;

      const chatLabel = chatType === 'private'
        ? `DM with ${from}`
        : `${chat} (${chatType})`;

      const activityText = `## Telegram Message in ${chatLabel}

**From:** ${from}
**Time:** ${timestamp}

${text.substring(0, 500)}${text.length > 500 ? '...' : ''}`;

      activities.push(
        createActivityMessage({
          text: activityText,
          sourceURL,
        })
      );
    }
  } catch (error) {
    console.error('Error fetching Telegram updates:', error);
  }

  return { activities, newLastUpdateId };
}

export const handleSchedule = async (
  config?: Record<string, string>,
  state?: Record<string, string>
) => {
  try {
    if (!config?.bot_token) {
      return [];
    }

    const settings = (state || {}) as unknown as TelegramSettings;
    const lastUpdateId = settings.lastUpdateId || 0;

    const messages = [];

    const { activities, newLastUpdateId } = await processUpdates(
      config.bot_token,
      lastUpdateId
    );

    messages.push(...activities);

    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date().toISOString(),
        lastUpdateId: newLastUpdateId,
        botId: config.bot_id || settings.botId,
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in handleSchedule:', error);
    return [];
  }
};
