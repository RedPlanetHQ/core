// import { IntegrationAccount } from '@redplanethq/sol-sdk';
import axios from 'axios';

import { getUserDetails } from './utils';

async function getMessage(accessToken: string, channel: string, ts: string) {
  const result = await axios.get('https://slack.com/api/conversations.history', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    params: {
      channel,
      latest: ts,
      inclusive: true,
      limit: 1,
    },
  });

  return result.data.messages?.[0];
}

async function getConversationInfo(accessToken: string, channel: string) {
  const result = await axios.get('https://slack.com/api/conversations.info', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      channel,
    },
  });

  return result.data.channel;
}

export const createActivityEvent = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventBody: any,
  config: any,
) => {
  const { eventData } = eventBody;
  if (eventData.event.type === 'message' && eventData.event.channel === 'D06UAK42494') {
    const event = eventData.event;

    if (!config) {
      throw new Error('Integration configuration not found');
    }

    const accessToken = config.access_token;

    const text = `DM with SOL channel Content: '${event.text}'`;

    const permalinkResponse = await axios.get(
      `https://slack.com/api/chat.getPermalink?channel=${event.channel}&message_ts=${event.ts}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    const activity = {
      sourceURL: permalinkResponse.data.permalink,
      text,
      integrationAccountId: config.integrationAccountId,
      taskId: null,
    };

    await axios.post('/api/v1/activity', activity);
  }

  if (eventData.event.type === 'reaction_added' && eventData.event.reaction === 'eyes') {
    const event = eventData.event;

    if (!config) {
      throw new Error('Integration configuration not found');
    }

    const accessToken = config.access_token;
    const channel = event.item.channel;
    const ts = event.item.ts;

    const eventMessage = await getMessage(accessToken, channel, ts);
    const mentionedUsers = getMentionUsers(eventMessage.text);

    const [userDetails, conversationInfo] = await Promise.all([
      getUserDetails([eventMessage.user, ...mentionedUsers], config.access_token),
      getConversationInfo(accessToken, channel),
    ]);

    const userIdMap = new Map(userDetails.map((user) => [user.id, user]));

    const eventMessageText = eventMessage.text.replace(/<@U\w+>/g, (match: string) => {
      const userId = match.replace(/<@|>/g, '');
      const user = userIdMap.get(userId);
      return user ? `@${user.real_name}|${userId}` : match;
    });

    let conversationContext;
    if (conversationInfo.is_im) {
      const dmUser = userIdMap.get(conversationInfo.user);
      conversationContext = `direct message with ${dmUser?.real_name}(${conversationInfo.user})`;
    } else if (conversationInfo.is_group) {
      conversationContext = `private channel ${conversationInfo.name}(${conversationInfo.id})`;
    } else {
      conversationContext = `channel ${conversationInfo.name}(${conversationInfo.id})`;
    }

    const text = `Message to User from ${userIdMap.get(eventMessage.user)?.real_name}(${eventMessage.user}) in ${conversationContext} at ${eventMessage.ts}. Content: '${eventMessageText}'`;

    const permalinkResponse = await axios.get(
      `https://slack.com/api/chat.getPermalink?channel=${channel}&message_ts=${ts}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    const activity = {
      sourceURL: permalinkResponse.data.permalink,
      source: 'slack',
      text,
      integrationAccountId: config.integrationAccountId,
    };

    await axios.post('/api/v1/activity', activity);
  }
  return { message: `Processed activity from slack` };
};

function getMentionUsers(message: string): string[] {
  const mentionUsers = message.matchAll(/<@U\w+>/g);
  return Array.from(mentionUsers).map((match) => match[0].replace(/<@|>/g, ''));
}
