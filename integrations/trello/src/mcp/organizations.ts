/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Schemas ───────────────────────────────────────────────────────────────

const GetOrganizationSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization (workspace) to retrieve'),
});

const CreateOrganizationSchema = z.object({
  displayName: z.string().min(1).describe('Display name for the organization (required, at least 1 character)'),
  name: z.string().optional().describe('URL-safe name for the organization (3+ characters, lowercase letters, underscores, and hyphens only)'),
  desc: z.string().optional().describe('Description of the organization'),
  website: z.string().optional().describe('Website URL for the organization (must include http:// or https://)'),
});

const UpdateOrganizationSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization to update'),
  name: z.string().optional().describe('New URL-safe name for the organization'),
  displayName: z.string().optional().describe('New display name for the organization'),
  desc: z.string().optional().describe('New description for the organization'),
  website: z.string().optional().describe('New website URL for the organization'),
  prefs_permissionLevel: z
    .enum(['private', 'public'])
    .optional()
    .describe('Visibility of the organization: private (members only) or public (anyone)'),
  prefs_boardVisibilityRestrict_private: z
    .enum(['admin', 'none', 'org'])
    .optional()
    .describe('Who can create private boards: admin (admins only), none (no one), or org (organization members)'),
});

const DeleteOrganizationSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization to permanently delete'),
});

const GetOrganizationBoardsSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization'),
  filter: z
    .enum(['all', 'members', 'public', 'open', 'closed'])
    .optional()
    .default('all')
    .describe('Filter boards by type (default: all)'),
});

const GetOrganizationMembersSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization'),
  filter: z
    .enum(['all', 'admins', 'normal', 'owners', 'none'])
    .optional()
    .default('all')
    .describe('Filter members by role (default: all)'),
});

const GetOrganizationMembershipsSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization'),
  filter: z
    .enum(['all', 'active', 'admin', 'deactivated', 'me', 'none', 'normal'])
    .optional()
    .default('all')
    .describe('Filter memberships by status or role (default: all)'),
});

const GetOrganizationActionsSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization'),
  filter: z.string().optional().describe('Comma-separated list of action types to filter (e.g. "createBoard,addMemberToOrganization")'),
  limit: z.number().optional().default(50).describe('Maximum number of actions to return (default: 50)'),
});

const GetOrganizationMembersInvitedSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization'),
});

const RemoveOrganizationMemberSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization'),
  member_id: z.string().describe('The ID of the member to remove from the organization'),
});

const GetOrganizationPluginsSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization'),
});

const AddOrganizationLogoSchema = z.object({
  org_id: z.string().describe('The ID or name of the organization'),
  file_url: z.string().describe('URL of the image to use as the organization logo'),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export function getTools(): object[] {
  return [
    {
      name: 'trello_get_organization',
      description: 'Get details of a Trello organization (workspace) including name, description, website, and logo.',
      inputSchema: zodToJsonSchema(GetOrganizationSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_create_organization',
      description: 'Create a new Trello organization (workspace). A display name is required.',
      inputSchema: zodToJsonSchema(CreateOrganizationSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: 'trello_update_organization',
      description: 'Update settings and information for an existing Trello organization (workspace).',
      inputSchema: zodToJsonSchema(UpdateOrganizationSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_delete_organization',
      description: 'Permanently delete a Trello organization (workspace). This action cannot be undone.',
      inputSchema: zodToJsonSchema(DeleteOrganizationSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_get_organization_boards',
      description: 'Get all boards belonging to a Trello organization (workspace).',
      inputSchema: zodToJsonSchema(GetOrganizationBoardsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_organization_members',
      description: 'Get all members of a Trello organization (workspace), optionally filtered by role.',
      inputSchema: zodToJsonSchema(GetOrganizationMembersSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_organization_memberships',
      description: 'Get all memberships for a Trello organization including member roles and statuses.',
      inputSchema: zodToJsonSchema(GetOrganizationMembershipsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_organization_actions',
      description: 'Get recent actions (activity history) for a Trello organization (workspace).',
      inputSchema: zodToJsonSchema(GetOrganizationActionsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_get_organization_members_invited',
      description: 'Get members who have been invited to a Trello organization but have not yet accepted.',
      inputSchema: zodToJsonSchema(GetOrganizationMembersInvitedSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_remove_organization_member',
      description: 'Remove a member from a Trello organization (workspace).',
      inputSchema: zodToJsonSchema(RemoveOrganizationMemberSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: 'trello_get_organization_plugins',
      description: 'Get all enabled plugins (power-ups) for a Trello organization (workspace).',
      inputSchema: zodToJsonSchema(GetOrganizationPluginsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: 'trello_add_organization_logo',
      description: 'Set a logo image for a Trello organization by providing the URL of the image.',
      inputSchema: zodToJsonSchema(AddOrganizationLogoSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
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
      case 'trello_get_organization': {
        const { org_id } = GetOrganizationSchema.parse(args);
        const response = await client.get(`/organizations/${org_id}`);
        const o = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Organization: ${o.displayName}\nID: ${o.id}\nName: ${o.name}\nDescription: ${o.desc || 'N/A'}\nURL: ${o.url || 'N/A'}\nWebsite: ${o.website || 'N/A'}\nLogo URL: ${o.logoUrl || 'N/A'}`,
            },
          ],
        };
      }

      case 'trello_create_organization': {
        const { displayName, name, desc, website } = CreateOrganizationSchema.parse(args);

        const body: Record<string, any> = { displayName };
        if (name) body.name = name;
        if (desc) body.desc = desc;
        if (website) body.website = website;

        const response = await client.post('/organizations', body);
        const o = response.data;

        return {
          content: [
            {
              type: 'text',
              text: `Organization created!\nID: ${o.id}\nName: ${o.name}\nDisplay Name: ${o.displayName}\nURL: ${o.url || 'N/A'}`,
            },
          ],
        };
      }

      case 'trello_update_organization': {
        const {
          org_id,
          name,
          displayName,
          desc,
          website,
          prefs_permissionLevel,
          prefs_boardVisibilityRestrict_private,
        } = UpdateOrganizationSchema.parse(args);

        const body: Record<string, any> = {};
        if (name !== undefined) body.name = name;
        if (displayName !== undefined) body.displayName = displayName;
        if (desc !== undefined) body.desc = desc;
        if (website !== undefined) body.website = website;
        if (prefs_permissionLevel !== undefined) body['prefs/permissionLevel'] = prefs_permissionLevel;
        if (prefs_boardVisibilityRestrict_private !== undefined)
          body['prefs/boardVisibilityRestrict/private'] = prefs_boardVisibilityRestrict_private;

        await client.put(`/organizations/${org_id}`, body);

        return {
          content: [{ type: 'text', text: `Organization ${org_id} updated successfully.` }],
        };
      }

      case 'trello_delete_organization': {
        const { org_id } = DeleteOrganizationSchema.parse(args);
        await client.delete(`/organizations/${org_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Organization ${org_id} has been permanently deleted.`,
            },
          ],
        };
      }

      case 'trello_get_organization_boards': {
        const { org_id, filter } = GetOrganizationBoardsSchema.parse(args);
        const response = await client.get(`/organizations/${org_id}/boards`, {
          params: { filter },
        });
        const boards: any[] = response.data || [];

        if (boards.length === 0) {
          return { content: [{ type: 'text', text: 'No boards found in this organization.' }] };
        }

        const list = boards
          .map((b: any) => `ID: ${b.id}\nName: ${b.name}\nDescription: ${b.desc || 'N/A'}\nURL: ${b.url || 'N/A'}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${boards.length} board(s):\n\n${list}` }],
        };
      }

      case 'trello_get_organization_members': {
        const { org_id, filter } = GetOrganizationMembersSchema.parse(args);
        const response = await client.get(`/organizations/${org_id}/members`, {
          params: { filter },
        });
        const members: any[] = response.data || [];

        if (members.length === 0) {
          return { content: [{ type: 'text', text: 'No members found in this organization.' }] };
        }

        const list = members
          .map(
            (m: any) =>
              `ID: ${m.id}\nFull Name: ${m.fullName || 'N/A'}\nUsername: ${m.username}\nMember Type: ${m.memberType || 'N/A'}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${members.length} member(s):\n\n${list}` }],
        };
      }

      case 'trello_get_organization_memberships': {
        const { org_id, filter } = GetOrganizationMembershipsSchema.parse(args);
        const response = await client.get(`/organizations/${org_id}/memberships`, {
          params: { filter },
        });
        const memberships: any[] = response.data || [];

        if (memberships.length === 0) {
          return { content: [{ type: 'text', text: 'No memberships found in this organization.' }] };
        }

        const list = memberships
          .map(
            (ms: any) =>
              `ID: ${ms.id}\nMember ID: ${ms.idMember}\nType: ${ms.memberType}\nActive: ${!ms.deactivated}`,
          )
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${memberships.length} membership(s):\n\n${list}` }],
        };
      }

      case 'trello_get_organization_actions': {
        const { org_id, filter, limit } = GetOrganizationActionsSchema.parse(args);

        const params: Record<string, any> = { limit };
        if (filter) params.filter = filter;

        const response = await client.get(`/organizations/${org_id}/actions`, { params });
        const actions: any[] = response.data || [];

        if (actions.length === 0) {
          return { content: [{ type: 'text', text: 'No actions found for this organization.' }] };
        }

        const list = actions
          .map((a: any) => `ID: ${a.id}\nType: ${a.type}\nDate: ${a.date}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${actions.length} action(s):\n\n${list}` }],
        };
      }

      case 'trello_get_organization_members_invited': {
        const { org_id } = GetOrganizationMembersInvitedSchema.parse(args);
        const response = await client.get(`/organizations/${org_id}/membersInvited`);
        const members: any[] = response.data || [];

        if (members.length === 0) {
          return { content: [{ type: 'text', text: 'No invited members found for this organization.' }] };
        }

        const list = members
          .map((m: any) => `ID: ${m.id}\nFull Name: ${m.fullName || 'N/A'}\nUsername: ${m.username}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${members.length} invited member(s):\n\n${list}` }],
        };
      }

      case 'trello_remove_organization_member': {
        const { org_id, member_id } = RemoveOrganizationMemberSchema.parse(args);
        await client.delete(`/organizations/${org_id}/members/${member_id}`);

        return {
          content: [
            {
              type: 'text',
              text: `Member ${member_id} has been removed from organization ${org_id}.`,
            },
          ],
        };
      }

      case 'trello_get_organization_plugins': {
        const { org_id } = GetOrganizationPluginsSchema.parse(args);
        const response = await client.get(`/organizations/${org_id}/plugins`);
        const plugins: any[] = response.data || [];

        if (plugins.length === 0) {
          return { content: [{ type: 'text', text: 'No plugins (power-ups) enabled for this organization.' }] };
        }

        const list = plugins
          .map((p: any) => `ID: ${p.id}\nName: ${p.name || 'N/A'}\nPublic: ${p.public}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${plugins.length} plugin(s):\n\n${list}` }],
        };
      }

      case 'trello_add_organization_logo': {
        const { org_id, file_url } = AddOrganizationLogoSchema.parse(args);
        await client.post(`/organizations/${org_id}/logo`, { file: file_url });

        return {
          content: [
            {
              type: 'text',
              text: `Logo updated successfully for organization ${org_id}.`,
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
