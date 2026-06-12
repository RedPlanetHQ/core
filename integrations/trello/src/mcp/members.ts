/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const GetMemberSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
});

const UpdateMemberSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member to update. Defaults to "me" for the authenticated user.'),
  fullName: z.string().optional().describe('Full name of the member (1-256 characters)'),
  bio: z.string().optional().describe('Bio/description for the member profile'),
  initials: z.string().optional().describe('Initials for the member (2-4 characters)'),
  prefs_colorBlind: z.boolean().optional().describe('Enable or disable color blind mode'),
  prefs_locale: z.string().optional().describe('Locale preference (e.g. "en", "fr", "de")'),
  prefs_minutesBetweenSummaries: z.number().optional().describe('Minutes between email summary notifications (-1 to disable, 1, 60, or 480)'),
});

const GetMemberBoardsSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  filter: z
    .enum(['all', 'open', 'closed', 'starred', 'members', 'public', 'organization'])
    .optional()
    .default('open')
    .describe('Filter boards by type (default: open)'),
  fields: z.string().optional().describe('Comma-separated list of board fields to return (e.g. "name,url,desc")'),
});

const GetMemberCardsSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  filter: z
    .enum(['all', 'open', 'closed', 'visible'])
    .optional()
    .default('open')
    .describe('Filter cards by status (default: open)'),
});

const GetMemberOrganizationsSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  filter: z
    .enum(['all', 'members', 'public', 'none'])
    .optional()
    .describe('Filter organizations by type'),
});

const GetMemberNotificationsSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  filter: z.string().optional().describe('Comma-separated list of notification types to filter (e.g. "addedToBoard,mentionedOnCard")'),
  read_filter: z
    .enum(['all', 'read', 'unread'])
    .optional()
    .default('all')
    .describe('Filter by read status (default: all)'),
  limit: z.number().optional().default(20).describe('Maximum number of notifications to return (default: 20)'),
  page: z.number().optional().default(0).describe('Page number for pagination (default: 0)'),
});

const GetMemberActionsSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  filter: z.string().optional().describe('Comma-separated list of action types to filter (e.g. "createCard,commentCard")'),
  limit: z.number().optional().default(50).describe('Maximum number of actions to return (default: 50)'),
});

const GetMemberBoardStarsSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
});

const AddMemberBoardStarSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  idBoard: z.string().describe('The ID of the board to star'),
  pos: z
    .union([z.number(), z.enum(['top', 'bottom'])])
    .optional()
    .default('top')
    .describe('Position of the star in the starred boards list (default: top)'),
});

const UpdateMemberBoardStarSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  board_star_id: z.string().describe('The ID of the board star to update'),
  pos: z
    .union([z.number(), z.enum(['top', 'bottom'])])
    .describe('New position of the board star in the starred boards list'),
});

const DeleteMemberBoardStarSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  board_star_id: z.string().describe('The ID of the board star to delete'),
});

const GetMemberSavedSearchesSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
});

const AddMemberSavedSearchSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  name: z.string().describe('Name for the saved search'),
  query: z.string().describe('The search query string to save'),
  pos: z
    .union([z.number(), z.enum(['top', 'bottom'])])
    .optional()
    .describe('Position of the saved search in the list'),
});

const UpdateMemberSavedSearchSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  saved_search_id: z.string().describe('The ID of the saved search to update'),
  name: z.string().optional().describe('New name for the saved search'),
  query: z.string().optional().describe('New query string for the saved search'),
  pos: z
    .union([z.number(), z.enum(['top', 'bottom'])])
    .optional()
    .describe('New position of the saved search in the list'),
});

const DeleteMemberSavedSearchSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
  saved_search_id: z.string().describe('The ID of the saved search to delete'),
});

const GetMemberCustomBoardBackgroundsSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
});

const GetMemberCustomEmojiSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
});

const GetMemberCustomStickersSchema = z.object({
  member_id: z.string().default('me').describe('The ID or username of the member. Defaults to "me" for the authenticated user.'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_get_member',
      description: 'Get profile details of a Trello member. Defaults to the authenticated user ("me") if no member ID is provided.',
      inputSchema: zodToJsonSchema(GetMemberSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_update_member',
      description: 'Update profile information for a Trello member. Defaults to the authenticated user. Can update name, bio, initials, and preferences.',
      inputSchema: zodToJsonSchema(UpdateMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_member_boards',
      description: 'Get all boards that a Trello member belongs to. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(GetMemberBoardsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_member_cards',
      description: 'Get all cards assigned to a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(GetMemberCardsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_member_organizations',
      description: 'Get all organizations (workspaces) that a Trello member belongs to. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(GetMemberOrganizationsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_member_notifications',
      description: 'Get notifications for a Trello member. Defaults to the authenticated user. Supports filtering by type and read status.',
      inputSchema: zodToJsonSchema(GetMemberNotificationsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_member_actions',
      description: 'Get recent actions (activity history) for a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(GetMemberActionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_member_board_stars',
      description: 'Get all starred boards for a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(GetMemberBoardStarsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_member_board_star',
      description: 'Star a board for a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(AddMemberBoardStarSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_member_board_star',
      description: 'Update the position of a starred board for a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(UpdateMemberBoardStarSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_member_board_star',
      description: 'Remove a board star (unstar a board) for a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(DeleteMemberBoardStarSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_get_member_saved_searches',
      description: 'Get all saved searches for a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(GetMemberSavedSearchesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_member_saved_search',
      description: 'Create a new saved search for a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(AddMemberSavedSearchSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_member_saved_search',
      description: 'Update an existing saved search for a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(UpdateMemberSavedSearchSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_member_saved_search',
      description: 'Delete a saved search for a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(DeleteMemberSavedSearchSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_get_member_custom_board_backgrounds',
      description: 'Get custom board backgrounds uploaded by a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(GetMemberCustomBoardBackgroundsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_member_custom_emoji',
      description: 'Get custom emoji created by a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(GetMemberCustomEmojiSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_member_custom_stickers',
      description: 'Get custom stickers uploaded by a Trello member. Defaults to the authenticated user.',
      inputSchema: zodToJsonSchema(GetMemberCustomStickersSchema),
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
      case 'trello_get_member': {
        const { member_id } = GetMemberSchema.parse(args);
        const response = await client.get(`/members/${member_id}`);
        const m = response.data;

        const orgs = (m.idOrganizations || []).join(', ') || 'None';

        return {
          content: [
            {
              type: 'text',
              text: `Member: ${m.fullName || m.username}\nID: ${m.id}\nUsername: ${m.username}\nBio: ${m.bio || 'N/A'}\nURL: ${m.url}\nAvatar URL: ${m.avatarUrl || 'N/A'}\nOrganizations: ${orgs}`,
            },
          ],
        };
      }

      case 'trello_update_member': {
        const {
          member_id,
          fullName,
          bio,
          initials,
          prefs_colorBlind,
          prefs_locale,
          prefs_minutesBetweenSummaries,
        } = UpdateMemberSchema.parse(args);

        const body: Record<string, any> = {};
        if (fullName !== undefined) body.fullName = fullName;
        if (bio !== undefined) body.bio = bio;
        if (initials !== undefined) body.initials = initials;
        if (prefs_colorBlind !== undefined) body['prefs/colorBlind'] = prefs_colorBlind;
        if (prefs_locale !== undefined) body['prefs/locale'] = prefs_locale;
        if (prefs_minutesBetweenSummaries !== undefined)
          body['prefs/minutesBetweenSummaries'] = prefs_minutesBetweenSummaries;

        await client.put(`/members/${member_id}`, body);

        return {
          content: [{ type: 'text', text: `Member ${member_id} updated successfully.` }],
        };
      }

      case 'trello_get_member_boards': {
        const { member_id, filter, fields } = GetMemberBoardsSchema.parse(args);

        const params: Record<string, any> = { filter };
        if (fields) params.fields = fields;

        const response = await client.get(`/members/${member_id}/boards`, { params });
        const boards: any[] = response.data || [];

        if (boards.length === 0) {
          return { content: [{ type: 'text', text: 'No boards found.' }] };
        }

        const list = boards
          .map((b: any) => `ID: ${b.id}\nName: ${b.name}\nDescription: ${b.desc || 'N/A'}\nURL: ${b.url || 'N/A'}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${boards.length} board(s):\n\n${list}` }],
        };
      }

      case 'trello_get_member_cards': {
        const { member_id, filter } = GetMemberCardsSchema.parse(args);
        const response = await client.get(`/members/${member_id}/cards`, { params: { filter } });
        const cards: any[] = response.data || [];

        if (cards.length === 0) {
          return { content: [{ type: 'text', text: 'No cards found.' }] };
        }

        const list = cards
          .map(
            (c: any) =>
              `ID: ${c.id}\nName: ${c.name}\nBoard ID: ${c.idBoard}\nList ID: ${c.idList}\nDue: ${c.due || 'N/A'}\nURL: ${c.url}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${cards.length} card(s):\n\n${list}` }],
        };
      }

      case 'trello_get_member_organizations': {
        const { member_id, filter } = GetMemberOrganizationsSchema.parse(args);

        const params: Record<string, any> = {};
        if (filter) params.filter = filter;

        const response = await client.get(`/members/${member_id}/organizations`, { params });
        const orgs: any[] = response.data || [];

        if (orgs.length === 0) {
          return { content: [{ type: 'text', text: 'No organizations found.' }] };
        }

        const list = orgs
          .map(
            (o: any) =>
              `ID: ${o.id}\nName: ${o.name}\nDisplay Name: ${o.displayName}\nURL: ${o.url || 'N/A'}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${orgs.length} organization(s):\n\n${list}` }],
        };
      }

      case 'trello_get_member_notifications': {
        const { member_id, filter, read_filter, limit, page } = GetMemberNotificationsSchema.parse(args);

        const params: Record<string, any> = { read_filter, limit, page };
        if (filter) params.filter = filter;

        const response = await client.get(`/members/${member_id}/notifications`, { params });
        const notifications: any[] = response.data || [];

        if (notifications.length === 0) {
          return { content: [{ type: 'text', text: 'No notifications found.' }] };
        }

        const list = notifications
          .map(
            (n: any) =>
              `ID: ${n.id}\nType: ${n.type}\nUnread: ${n.unread}\nDate: ${n.date}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${notifications.length} notification(s):\n\n${list}` }],
        };
      }

      case 'trello_get_member_actions': {
        const { member_id, filter, limit } = GetMemberActionsSchema.parse(args);

        const params: Record<string, any> = { limit };
        if (filter) params.filter = filter;

        const response = await client.get(`/members/${member_id}/actions`, { params });
        const actions: any[] = response.data || [];

        if (actions.length === 0) {
          return { content: [{ type: 'text', text: 'No actions found.' }] };
        }

        const list = actions
          .map((a: any) => `ID: ${a.id}\nType: ${a.type}\nDate: ${a.date}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${actions.length} action(s):\n\n${list}` }],
        };
      }

      case 'trello_get_member_board_stars': {
        const { member_id } = GetMemberBoardStarsSchema.parse(args);
        const response = await client.get(`/members/${member_id}/boardStars`);
        const stars: any[] = response.data || [];

        if (stars.length === 0) {
          return { content: [{ type: 'text', text: 'No starred boards found.' }] };
        }

        const list = stars
          .map((s: any) => `ID: ${s.id}\nBoard ID: ${s.idBoard}\nPosition: ${s.pos}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${stars.length} starred board(s):\n\n${list}` }],
        };
      }

      case 'trello_add_member_board_star': {
        const { member_id, idBoard, pos } = AddMemberBoardStarSchema.parse(args);
        const response = await client.post(`/members/${member_id}/boardStars`, { idBoard, pos });
        const star = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Board starred!\nStar ID: ${star.id}\nBoard ID: ${star.idBoard}\nPosition: ${star.pos}`,
            },
          ],
        };
      }

      case 'trello_update_member_board_star': {
        const { member_id, board_star_id, pos } = UpdateMemberBoardStarSchema.parse(args);
        await client.put(`/members/${member_id}/boardStars/${board_star_id}`, { pos });

        return {
          content: [{ type: 'text', text: `Board star ${board_star_id} updated successfully.` }],
        };
      }

      case 'trello_delete_member_board_star': {
        const { member_id, board_star_id } = DeleteMemberBoardStarSchema.parse(args);
        await client.delete(`/members/${member_id}/boardStars/${board_star_id}`);

        return {
          content: [{ type: 'text', text: `Board star ${board_star_id} removed successfully.` }],
        };
      }

      case 'trello_get_member_saved_searches': {
        const { member_id } = GetMemberSavedSearchesSchema.parse(args);
        const response = await client.get(`/members/${member_id}/savedSearches`);
        const searches: any[] = response.data || [];

        if (searches.length === 0) {
          return { content: [{ type: 'text', text: 'No saved searches found.' }] };
        }

        const list = searches
          .map((s: any) => `ID: ${s.id}\nName: ${s.name}\nQuery: ${s.query}\nPosition: ${s.pos}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${searches.length} saved search(es):\n\n${list}` }],
        };
      }

      case 'trello_add_member_saved_search': {
        const { member_id, name, query, pos } = AddMemberSavedSearchSchema.parse(args);

        const body: Record<string, any> = { name, query };
        if (pos !== undefined) body.pos = pos;

        const response = await client.post(`/members/${member_id}/savedSearches`, body);
        const search = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Saved search created!\nID: ${search.id}\nName: ${search.name}\nQuery: ${search.query}`,
            },
          ],
        };
      }

      case 'trello_update_member_saved_search': {
        const { member_id, saved_search_id, name, query, pos } = UpdateMemberSavedSearchSchema.parse(args);

        const body: Record<string, any> = {};
        if (name !== undefined) body.name = name;
        if (query !== undefined) body.query = query;
        if (pos !== undefined) body.pos = pos;

        await client.put(`/members/${member_id}/savedSearches/${saved_search_id}`, body);

        return {
          content: [{ type: 'text', text: `Saved search ${saved_search_id} updated successfully.` }],
        };
      }

      case 'trello_delete_member_saved_search': {
        const { member_id, saved_search_id } = DeleteMemberSavedSearchSchema.parse(args);
        await client.delete(`/members/${member_id}/savedSearches/${saved_search_id}`);

        return {
          content: [{ type: 'text', text: `Saved search ${saved_search_id} deleted successfully.` }],
        };
      }

      case 'trello_get_member_custom_board_backgrounds': {
        const { member_id } = GetMemberCustomBoardBackgroundsSchema.parse(args);
        const response = await client.get(`/members/${member_id}/customBoardBackgrounds`);
        const backgrounds: any[] = response.data || [];

        if (backgrounds.length === 0) {
          return { content: [{ type: 'text', text: 'No custom board backgrounds found.' }] };
        }

        const list = backgrounds
          .map((bg: any) => `ID: ${bg.id}\nBrightness: ${bg.brightness || 'N/A'}\nTile: ${bg.tile}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${backgrounds.length} custom board background(s):\n\n${list}` }],
        };
      }

      case 'trello_get_member_custom_emoji': {
        const { member_id } = GetMemberCustomEmojiSchema.parse(args);
        const response = await client.get(`/members/${member_id}/customEmoji`);
        const emojis: any[] = response.data || [];

        if (emojis.length === 0) {
          return { content: [{ type: 'text', text: 'No custom emoji found.' }] };
        }

        const list = emojis
          .map((e: any) => `ID: ${e.id}\nName: ${e.name}\nURL: ${e.url || 'N/A'}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${emojis.length} custom emoji:\n\n${list}` }],
        };
      }

      case 'trello_get_member_custom_stickers': {
        const { member_id } = GetMemberCustomStickersSchema.parse(args);
        const response = await client.get(`/members/${member_id}/customStickers`);
        const stickers: any[] = response.data || [];

        if (stickers.length === 0) {
          return { content: [{ type: 'text', text: 'No custom stickers found.' }] };
        }

        const list = stickers
          .map((s: any) => `ID: ${s.id}\nURL: ${s.url || 'N/A'}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${stickers.length} custom sticker(s):\n\n${list}` }],
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
