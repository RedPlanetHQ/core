/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const SearchSchema = z.object({
  query: z.string().describe('The search query string to find matching Trello objects'),
  modelTypes: z
    .array(z.enum(['actions', 'boards', 'cards', 'members', 'organizations']))
    .optional()
    .default(['boards', 'cards'])
    .describe('Types of Trello objects to search across (default: boards, cards)'),
  cards_limit: z
    .number()
    .optional()
    .default(10)
    .describe('Maximum number of cards to return (default: 10, max: 1000)'),
  cards_page: z
    .number()
    .optional()
    .default(0)
    .describe('Page of cards results to return (default: 0)'),
  card_fields: z
    .string()
    .optional()
    .describe('Comma-separated list of card fields to include in results'),
  boards_limit: z
    .number()
    .optional()
    .default(10)
    .describe('Maximum number of boards to return (default: 10, max: 1000)'),
  board_fields: z
    .string()
    .optional()
    .describe('Comma-separated list of board fields to include in results'),
  organizations_limit: z
    .number()
    .optional()
    .default(10)
    .describe('Maximum number of organizations to return (default: 10, max: 1000)'),
  members_limit: z
    .number()
    .optional()
    .default(10)
    .describe('Maximum number of members to return (default: 10, max: 1000)'),
  partial: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, matches the beginning of words in the search query (default: false)'),
});

const SearchMembersSchema = z.object({
  query: z.string().describe('The search query to find matching Trello members'),
  limit: z
    .number()
    .optional()
    .default(8)
    .describe('Maximum number of members to return (default: 8, max: 20)'),
  idBoard: z
    .string()
    .optional()
    .describe('Limit results to members of a specific board by its ID'),
  idOrganization: z
    .string()
    .optional()
    .describe('Limit results to members of a specific organization by its ID'),
  onlyOrgMembers: z
    .boolean()
    .optional()
    .describe('If true, only return members of the specified organization'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_search',
      description:
        'Search across Trello boards, cards, members, organizations, and actions using a query string. Supports pagination and field filtering.',
      inputSchema: zodToJsonSchema(SearchSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_search_members',
      description:
        'Search for Trello members by name or username. Optionally restrict results to members of a specific board or organization.',
      inputSchema: zodToJsonSchema(SearchMembersSchema),
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
      case 'trello_search': {
        const {
          query,
          modelTypes,
          cards_limit,
          cards_page,
          card_fields,
          boards_limit,
          board_fields,
          organizations_limit,
          members_limit,
          partial,
        } = SearchSchema.parse(args);

        const params: Record<string, any> = {
          query,
          modelTypes: modelTypes.join(','),
          cards_limit,
          cards_page,
          boards_limit,
          organizations_limit,
          members_limit,
          partial,
        };
        if (card_fields) params.card_fields = card_fields;
        if (board_fields) params.board_fields = board_fields;

        const response = await client.get('/search', { params });
        const result = response.data;
        const parts: string[] = [];

        const cards: any[] = result.cards || [];
        if (cards.length > 0) {
          const cardList = cards
            .map(
              (c: any) =>
                `Name: ${c.name}\nID: ${c.id}\nList ID: ${c.idList || 'N/A'}\nBoard ID: ${c.idBoard || 'N/A'}\nURL: ${c.url || 'N/A'}`,
            )
            .join('\n\n');
          parts.push(`Cards (${cards.length}):\n${cardList}`);
        }

        const boards: any[] = result.boards || [];
        if (boards.length > 0) {
          const boardList = boards
            .map((b: any) => `Name: ${b.name}\nID: ${b.id}\nURL: ${b.url || 'N/A'}`)
            .join('\n\n');
          parts.push(`Boards (${boards.length}):\n${boardList}`);
        }

        const members: any[] = result.members || [];
        if (members.length > 0) {
          const memberList = members
            .map(
              (m: any) =>
                `Name: ${m.fullName || m.username}\nUsername: @${m.username}\nID: ${m.id}`,
            )
            .join('\n\n');
          parts.push(`Members (${members.length}):\n${memberList}`);
        }

        const organizations: any[] = result.organizations || [];
        if (organizations.length > 0) {
          const orgList = organizations
            .map((o: any) => `Name: ${o.displayName || o.name}\nID: ${o.id}\nURL: ${o.url || 'N/A'}`)
            .join('\n\n');
          parts.push(`Organizations (${organizations.length}):\n${orgList}`);
        }

        if (parts.length === 0) {
          return { content: [{ type: 'text', text: 'No results found.' }] };
        }

        return {
          content: [{ type: 'text', text: parts.join('\n\n---\n\n') }],
        };
      }

      case 'trello_search_members': {
        const { query, limit, idBoard, idOrganization, onlyOrgMembers } =
          SearchMembersSchema.parse(args);

        const params: Record<string, any> = { query, limit };
        if (idBoard) params.idBoard = idBoard;
        if (idOrganization) params.idOrganization = idOrganization;
        if (onlyOrgMembers !== undefined) params.onlyOrgMembers = onlyOrgMembers;

        const response = await client.get('/search/members', { params });
        const members: any[] = response.data || [];

        if (members.length === 0) {
          return { content: [{ type: 'text', text: 'No members found matching the query.' }] };
        }

        const list = members
          .map(
            (m: any) =>
              `ID: ${m.id}\nUsername: @${m.username}\nFull Name: ${m.fullName || 'N/A'}\nAvatar URL: ${m.avatarUrl || 'N/A'}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${members.length} member(s):\n\n${list}` }],
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
