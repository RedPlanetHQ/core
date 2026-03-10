// import { IntegrationAccount } from '@redplanethq/sol-sdk';
import axios from 'axios';

import { getUserDetails } from './utils';

interface SlackActivityCreateParams {
  text: string;
  sourceURL: string;
}
/**
 * Creates an activity message based on Linear data
 */
function createActivityMessage(params: SlackActivityCreateParams) {
  return {
    type: 'activity',
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

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
  eventData: any,
  config: any,
) => {
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

    const text = `User ${userIdMap.get(eventMessage.user)?.real_name}(${eventMessage.user}) reacted with eyes emoji in ${conversationContext} at ${eventMessage.ts}. Content: '${eventMessageText}'`;

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

    return [createActivityMessage(activity)];
  }

  return [];
};

function getMentionUsers(message: string): string[] {
  const mentionUsers = message.matchAll(/<@U\w+>/g);
  return Array.from(mentionUsers).map((match) => match[0].replace(/<@|>/g, ''));
}
