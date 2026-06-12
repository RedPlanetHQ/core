import axios from 'axios';

import { getAuthHeaders } from './utils';

interface TrelloState {
  lastSyncTime?: string;
}

function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function describeAction(action: any): string | null {
  const type: string = action.type || '';
  const data = action.data || {};
  const member = action.memberCreator?.fullName || action.memberCreator?.username || 'Someone';

  switch (type) {
    case 'createCard':
      return `${member} created card "${data.card?.name}" on board "${data.board?.name}"`;
    case 'updateCard': {
      if (data.listBefore && data.listAfter) {
        return `${member} moved card "${data.card?.name}" from "${data.listBefore?.name}" to "${data.listAfter?.name}"`;
      }
      if (data.old?.closed === false) {
        return `${member} archived card "${data.card?.name}"`;
      }
      if (data.old?.closed === true) {
        return `${member} unarchived card "${data.card?.name}"`;
      }
      return `${member} updated card "${data.card?.name}"`;
    }
    case 'commentCard':
      return `${member} commented on card "${data.card?.name}": ${data.text || ''}`;
    case 'addMemberToCard':
      return `${member} added a member to card "${data.card?.name}"`;
    case 'removeMemberFromCard':
      return `${member} removed a member from card "${data.card?.name}"`;
    case 'createList':
      return `${member} created list "${data.list?.name}" on board "${data.board?.name}"`;
    case 'updateList':
      return `${member} updated list "${data.list?.name}"`;
    case 'addChecklistToCard':
      return `${member} added checklist "${data.checklist?.name}" to card "${data.card?.name}"`;
    case 'updateCheckItemStateOnCard':
      return `${member} ${data.checkItem?.state === 'complete' ? 'completed' : 'unchecked'} "${data.checkItem?.name}" on card "${data.card?.name}"`;
    case 'addAttachmentToCard':
      return `${member} added attachment to card "${data.card?.name}"`;
    case 'deleteCard':
      return `${member} deleted a card on board "${data.board?.name}"`;
    default:
      return null;
  }
}

function getCardUrl(action: any): string {
  const shortLink = action.data?.card?.shortLink;
  if (shortLink) {
    return `https://trello.com/c/${shortLink}`;
  }
  return `https://trello.com/b/${action.data?.board?.id || ''}`;
}

export async function handleSchedule(
  config?: Record<string, string>,
  state?: Record<string, string>,
) {
  try {
    if (!config?.access_token) {
      return [];
    }

    const settings = (state || {}) as TrelloState;
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();
    const headers = getAuthHeaders(config.access_token);

    // Fetch user's open boards
    let boards: any[] = [];
    try {
      const boardsResponse = await axios.get(
        'https://api.trello.com/1/members/me/boards',
        { headers, params: { filter: 'open' } },
      );
      boards = boardsResponse.data || [];
    } catch {
      return [];
    }

    const messages: any[] = [];

    // For each board, fetch actions since last sync
    for (const board of boards) {
      try {
        const actionsResponse = await axios.get(
          `https://api.trello.com/1/boards/${board.id}/actions`,
          {
            headers,
            params: { since: lastSyncTime, limit: 50 },
          },
        );

        const actions: any[] = actionsResponse.data || [];

        for (const action of actions) {
          const text = describeAction(action);
          if (text) {
            messages.push({
              type: 'activity',
              data: {
                text,
                sourceURL: getCardUrl(action),
              },
            });
          }
        }
      } catch {
        // Skip this board and continue
      }
    }

    // Update state with new sync time
    messages.push({
      type: 'state',
      data: {
        lastSyncTime: new Date().toISOString(),
      },
    });

    return messages;
  } catch {
    return [];
  }
}
