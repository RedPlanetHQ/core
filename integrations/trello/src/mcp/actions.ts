/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const GetActionSchema = z.object({
  action_id: z.string().describe('The ID of the action to retrieve'),
});

const UpdateActionSchema = z.object({
  action_id: z.string().describe('The ID of the comment action to update'),
  text: z.string().describe('The new comment text (only works for commentCard actions)'),
});

const DeleteActionSchema = z.object({
  action_id: z.string().describe('The ID of the action to delete'),
});

const GetActionReactionsSchema = z.object({
  action_id: z.string().describe('The ID of the action to get reactions for'),
});

const AddActionReactionSchema = z.object({
  action_id: z.string().describe('The ID of the action to react to'),
  shortName: z.string().describe('The emoji short name to react with (e.g. "thumbsup", "heart", "tada")'),
  skinVariation: z.string().optional().describe('Skin tone variation for the emoji (e.g. "1F3FB")'),
  native: z.string().optional().describe('The native emoji character (e.g. "👍") as an alternative to shortName'),
});

const DeleteActionReactionSchema = z.object({
  action_id: z.string().describe('The ID of the action the reaction belongs to'),
  reaction_id: z.string().describe('The ID of the reaction to delete'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_get_action',
      description: 'Get details of a specific Trello action by its ID. Actions represent events on a board such as card moves, comments, or member additions.',
      inputSchema: zodToJsonSchema(GetActionSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_update_action',
      description: 'Update the text of a comment action on a Trello card. Only works for commentCard action types.',
      inputSchema: zodToJsonSchema(UpdateActionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_action',
      description: 'Delete a Trello action. Only comment actions can be deleted.',
      inputSchema: zodToJsonSchema(DeleteActionSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_get_action_reactions',
      description: 'Get all emoji reactions on a Trello action (comment).',
      inputSchema: zodToJsonSchema(GetActionReactionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_action_reaction',
      description: 'Add an emoji reaction to a Trello action (comment). Provide either a shortName (e.g. "thumbsup") or a native emoji character.',
      inputSchema: zodToJsonSchema(AddActionReactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_delete_action_reaction',
      description: 'Remove an emoji reaction from a Trello action (comment).',
      inputSchema: zodToJsonSchema(DeleteActionReactionSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
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
      case 'trello_get_action': {
        const { action_id } = GetActionSchema.parse(args);
        const response = await client.get(`/actions/${action_id}`);
        const a = response.data;

        const creator = a.memberCreator
          ? `${a.memberCreator.fullName || a.memberCreator.username} (@${a.memberCreator.username})`
          : 'N/A';

        const dataSummary = a.data
          ? Object.entries(a.data)
              .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
              .map(([k, v]) => `  ${k}: ${v}`)
              .join('\n')
          : 'N/A';

        return {
          content: [
            {
              type: 'text',
              text: `Action ID: ${a.id}\nType: ${a.type}\nDate: ${a.date}\nCreated by: ${creator}\nData:\n${dataSummary}`,
            },
          ],
        };
      }

      case 'trello_update_action': {
        const { action_id, text } = UpdateActionSchema.parse(args);
        await client.put(`/actions/${action_id}`, { text });

        return {
          content: [
            {
              type: 'text',
              text: `Action ${action_id} updated successfully.`,
            },
          ],
        };
      }

      case 'trello_delete_action': {
        const { action_id } = DeleteActionSchema.parse(args);
        await client.delete(`/actions/${action_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Action ${action_id} deleted successfully.`,
            },
          ],
        };
      }

      case 'trello_get_action_reactions': {
        const { action_id } = GetActionReactionsSchema.parse(args);
        const response = await client.get(`/actions/${action_id}/reactions`);
        const reactions: any[] = response.data || [];

        if (reactions.length === 0) {
          return { content: [{ type: 'text', text: 'No reactions found on this action.' }] };
        }

        const list = reactions
          .map((r: any) => {
            const emoji = r.emoji
              ? `${r.emoji.native || r.emoji.shortName} (${r.emoji.shortName})`
              : 'N/A';
            const member = r.member
              ? `${r.member.fullName || r.member.username} (@${r.member.username})`
              : 'Unknown';
            return `ID: ${r.id}\nEmoji: ${emoji}\nMember: ${member}`;
          })
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${reactions.length} reaction(s):\n\n${list}` }],
        };
      }

      case 'trello_add_action_reaction': {
        const { action_id, shortName, skinVariation, native } = AddActionReactionSchema.parse(args);

        const body: Record<string, any> = { shortName };
        if (skinVariation) body.skinVariation = skinVariation;
        if (native) body.native = native;

        const response = await client.post(`/actions/${action_id}/reactions`, body);
        const r = response.data;

        const emoji = r.emoji
          ? `${r.emoji.native || r.emoji.shortName} (${r.emoji.shortName})`
          : shortName;

        return {
          content: [
            {
              type: 'text',
              text: `Reaction added!\nReaction ID: ${r.id}\nEmoji: ${emoji}`,
            },
          ],
        };
      }

      case 'trello_delete_action_reaction': {
        const { action_id, reaction_id } = DeleteActionReactionSchema.parse(args);
        await client.delete(`/actions/${action_id}/reactions/${reaction_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Reaction ${reaction_id} removed from action ${action_id}.`,
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
