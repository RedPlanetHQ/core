import axios, { AxiosInstance } from 'axios';

interface DiscordConfig {
  access_token: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  bot_token?: string;
  userId?: string;
  guilds?: any[];
}

interface DiscordSettings {
  lastSyncTime?: string;
  lastUserEventTime?: string;
  userId?: string;
  trackedChannels?: string[];
}

interface DiscordActivityCreateParams {
  text: string;
  sourceURL: string;
}

/**
 * Creates an activity message based on Discord data
 */
function createActivityMessage(params: DiscordActivityCreateParams) {
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
 * Create Discord API client
 */
async function getDiscordClient(config: DiscordConfig): Promise<AxiosInstance> {
  // Try to refresh token if needed
  let accessToken = config.access_token;

  if (config.refresh_token && config.client_id && config.client_secret) {
    try {
      const tokenResponse = await axios.post(
        'https://discord.com/api/oauth2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: config.client_id,
          client_secret: config.client_secret,
          refresh_token: config.refresh_token,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      accessToken = tokenResponse.data.access_token;
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
  }

  // Use bot token if available, otherwise use OAuth token
  const authHeader = config.bot_token
    ? `Bot ${config.bot_token}`
    : `Bearer ${accessToken}`;

  return axios.create({
    baseURL: 'https://discord.com/api/v10',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Convert Discord snowflake ID to timestamp
 */
function snowflakeToTimestamp(snowflake: string): number {
  const DISCORD_EPOCH = 1420070400000;
  return Number(BigInt(snowflake) >> 22n) + DISCORD_EPOCH;
}

/**
 * Fetch and process recent messages from tracked channels
 */
async function processRecentMessages(
  client: AxiosInstance,
  lastSyncTime: string,
  trackedChannels: string[],
  userId: string
): Promise<any[]> {
  const activities = [];
  const lastSyncTimestamp = new Date(lastSyncTime).getTime();

  for (const channelId of trackedChannels) {
    try {
      // Get recent messages from channel
      const response = await client.get(`/channels/${channelId}/messages`, {
        params: { limit: 50 },
      });

      const messages = response.data || [];

      // Get channel info for context
      let channelInfo;
      try {
        const channelResponse = await client.get(`/channels/${channelId}`);
        channelInfo = channelResponse.data;
      } catch (error) {
        console.error('Error fetching channel info:', error);
        continue;
      }

      for (const message of messages) {
        try {
          // Convert message ID (snowflake) to timestamp
          const messageTimestamp = snowflakeToTimestamp(message.id);

          // Skip if message is older than last sync
          if (messageTimestamp < lastSyncTimestamp) {
            continue;
          }

          // Skip if message is from the bot user
          if (message.author.id === userId) {
            continue;
          }

          const author = message.author.username;
          const content = message.content || '[embed/attachment]';
          const timestamp = new Date(message.timestamp).toLocaleString();
          const guildId = channelInfo.guild_id;
          const channelName = channelInfo.name;

          // Create Discord message URL
          const sourceURL = `https://discord.com/channels/${guildId}/${channelId}/${message.id}`;

          const text = `## 💬 Discord Message in #${channelName}

**Author:** ${author}
**Time:** ${timestamp}

${content.substring(0, 500)}${content.length > 500 ? '...' : ''}`;

          activities.push(
            createActivityMessage({
              text,
              sourceURL,
            })
          );
        } catch (error) {
          console.error('Error processing message:', error);
        }
      }
    } catch (error) {
      console.error(`Error fetching messages from channel ${channelId}:`, error);
    }
  }

  return activities;
}

/**
 * Auto-discover important channels to track
 */
async function discoverTrackedChannels(
  client: AxiosInstance,
  guilds: any[]
): Promise<string[]> {
  const trackedChannels: string[] = [];

  for (const guild of guilds.slice(0, 5)) {
    // Limit to first 5 guilds
    try {
      const response = await client.get(`/guilds/${guild.id}/channels`);
      const channels = response.data || [];

      // Track text channels (type 0) and announcement channels (type 5)
      const importantChannels = channels
        .filter((ch: any) => ch.type === 0 || ch.type === 5)
        .filter((ch: any) => {
          const name = ch.name.toLowerCase();
          // Track channels with important-sounding names
          return (
            name.includes('general') ||
            name.includes('announcement') ||
            name.includes('important') ||
            name.includes('updates')
          );
        })
        .slice(0, 3) // Limit to 3 channels per guild
        .map((ch: any) => ch.id);

      trackedChannels.push(...importantChannels);
    } catch (error) {
      console.error(`Error fetching channels for guild ${guild.id}:`, error);
    }
  }

  return trackedChannels;
}

export const handleSchedule = async (
  config?: Record<string, string>,
  state?: Record<string, string>
) => {
  try {
    // Check if we have a valid access token
    if (!config?.access_token) {
      return [];
    }

    // Get settings or initialize if not present
    let settings = (state || {}) as DiscordSettings;

    // Default to 24 hours ago if no last sync time
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    // Get user ID
    const userId = config.userId || settings.userId || '';

    // Parse guilds from config
    let guilds = [];
    if (config.guilds) {
      try {
        guilds = typeof config.guilds === 'string' ? JSON.parse(config.guilds) : config.guilds;
      } catch (error) {
        console.error('Error parsing guilds:', error);
      }
    }

    // Create Discord client
    const discordConfig: DiscordConfig = {
      access_token: config.access_token,
      refresh_token: config.refresh_token || '',
      client_id: config.client_id || '',
      client_secret: config.client_secret || '',
      bot_token: config.bot_token || '',
      userId: userId,
      guilds: guilds,
    };

    const client = await getDiscordClient(discordConfig);

    // Discover tracked channels if not set
    if (!settings.trackedChannels || settings.trackedChannels.length === 0) {
      settings.trackedChannels = await discoverTrackedChannels(client, guilds);
    }

    // Collect all messages
    const messages = [];

    // Process recent messages from tracked channels
    if (settings.trackedChannels && settings.trackedChannels.length > 0) {
      const messageActivities = await processRecentMessages(
        client,
        lastSyncTime,
        settings.trackedChannels,
        userId
      );
      messages.push(...messageActivities);
    }

    // Update last sync time
    const newSyncTime = new Date().toISOString();

    // Add state message for saving settings
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: newSyncTime,
        lastUserEventTime: newSyncTime,
        userId: userId,
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in handleSchedule:', error);
    return [];
  }
};
