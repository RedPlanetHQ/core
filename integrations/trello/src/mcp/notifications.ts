/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const GetNotificationSchema = z.object({
  notification_id: z.string().describe('The ID of the notification to retrieve'),
});

const UpdateNotificationSchema = z.object({
  notification_id: z.string().describe('The ID of the notification to update'),
  unread: z.boolean().describe('Set to false to mark the notification as read, true to mark as unread'),
});

const MarkAllNotificationsReadSchema = z.object({
  read: z.boolean().optional().default(true).describe('Whether to mark notifications as read (default: true)'),
  ids: z
    .array(z.string())
    .optional()
    .describe('Specific notification IDs to mark as read. If omitted, all notifications are affected.'),
});

const GetNotificationBoardSchema = z.object({
  notification_id: z.string().describe('The ID of the notification whose associated board to retrieve'),
});

const GetNotificationCardSchema = z.object({
  notification_id: z.string().describe('The ID of the notification whose associated card to retrieve'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_get_notification',
      description: 'Get details of a specific Trello notification by its ID, including type, read status, date, and the member who created it.',
      inputSchema: zodToJsonSchema(GetNotificationSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_update_notification',
      description: 'Update a Trello notification, primarily to mark it as read or unread.',
      inputSchema: zodToJsonSchema(UpdateNotificationSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_mark_all_notifications_read',
      description: 'Mark all notifications as read for the authenticated user, or mark specific notifications by providing their IDs.',
      inputSchema: zodToJsonSchema(MarkAllNotificationsReadSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_notification_board',
      description: 'Get the board associated with a specific Trello notification.',
      inputSchema: zodToJsonSchema(GetNotificationBoardSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_notification_card',
      description: 'Get the card associated with a specific Trello notification.',
      inputSchema: zodToJsonSchema(GetNotificationCardSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
  ];
}

// ─── Tool Dispatcher ───────────────────────────────────────────────────────

export async function dispatch(
  name: string,
  args: Record<string, any>,
  client: AxiosInstance,
): Promise<any> {
  try {
    switch (name) {
      case 'trello_get_notification': {
        const { notification_id } = GetNotificationSchema.parse(args);
        const response = await client.get(`/notifications/${notification_id}`);
        const n = response.data;

        const creator = n.memberCreator
          ? `${n.memberCreator.fullName || n.memberCreator.username} (@${n.memberCreator.username})`
          : 'N/A';

        const dataSummary = n.data
          ? Object.entries(n.data)
              .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
              .map(([k, v]) => `  ${k}: ${v}`)
              .join('\n')
          : 'N/A';

        return {
          content: [
            {
              type: 'text',
              text: `Notification ID: ${n.id}\nType: ${n.type}\nUnread: ${n.unread}\nDate: ${n.date}\nCreated by: ${creator}\nData:\n${dataSummary}`,
            },
          ],
        };
      }

      case 'trello_update_notification': {
        const { notification_id, unread } = UpdateNotificationSchema.parse(args);
        await client.put(`/notifications/${notification_id}`, { unread });

        const status = unread ? 'unread' : 'read';
        return {
          content: [
            {
              type: 'text',
              text: `Notification ${notification_id} marked as ${status}.`,
            },
          ],
        };
      }

      case 'trello_mark_all_notifications_read': {
        const { read, ids } = MarkAllNotificationsReadSchema.parse(args);

        const body: Record<string, any> = { read };
        if (ids && ids.length > 0) body.ids = ids;

        await client.post('/notifications/all/read', body);

        const target = ids && ids.length > 0 ? `${ids.length} notification(s)` : 'all notifications';
        const status = read ? 'read' : 'unread';
        return {
          content: [{ type: 'text', text: `Successfully marked ${target} as ${status}.` }],
        };
      }

      case 'trello_get_notification_board': {
        const { notification_id } = GetNotificationBoardSchema.parse(args);
        const response = await client.get(`/notifications/${notification_id}/board`);
        const board = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Board ID: ${board.id}\nName: ${board.name}\nURL: ${board.url}`,
            },
          ],
        };
      }

      case 'trello_get_notification_card': {
        const { notification_id } = GetNotificationCardSchema.parse(args);
        const response = await client.get(`/notifications/${notification_id}/card`);
        const card = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Card ID: ${card.id}\nName: ${card.name}\nURL: ${card.url}`,
            },
          ],
        };
      }

      default:
        return null;
    }
  } catch (error: any) {
    const msg = error.response?.data?.message || error.response?.data?.error || error.message;
    return { content: [{ type: 'text', text: `Error: ${msg}` }] };
  }
}
