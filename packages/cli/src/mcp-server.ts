import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CoreClient } from '@redplanethq/sdk';
import { getConfig } from '@/config/index';

const BASE_URL = 'https://app.getcore.me';

// Tool schemas
const searchSchema = z.object({
	query: z.string().describe('Search query'),
	startTime: z.string().optional().describe('Start time filter (ISO format)'),
	endTime: z.string().optional().describe('End time filter (ISO format)'),
	labelIds: z.array(z.string()).optional().describe('Filter by label IDs'),
	limit: z.number().optional().describe('Maximum number of results'),
	structured: z.boolean().optional().describe('Return structured results'),
	sortBy: z.enum(['relevance', 'recency']).optional().describe('Sort order'),
});

const getIntegrationActionsSchema = z.object({
	accountId: z.string().describe('Integration account ID'),
	query: z.string().optional().describe('Filter actions by query'),
});

const executeIntegrationActionSchema = z.object({
	accountId: z.string().describe('Integration account ID'),
	action: z.string().describe('Action name to execute'),
	parameters: z.record(z.unknown()).optional().describe('Action parameters'),
});

// Initialize CoreClient
function getCoreClient(): CoreClient {
	const config = getConfig();
	const apiKey = config.auth?.apiKey;
	const url = config.auth?.url;

	if (!apiKey) {
		throw new Error('Not authenticated. Please run the login command first.');
	}

	return new CoreClient({
		baseUrl: url || BASE_URL,
		token: apiKey,
	});
}

export async function startMCPServer() {
	const server = new Server(
		{
			name: 'core-mcp',
			version: '1.0.0',
		},
		{
			capabilities: {
				tools: {},
			},
		},
	);

	// List available tools
	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return {
			tools: [
				{
					name: 'core_search',
					description: 'Search through CORE memory with semantic search',
					inputSchema: zodToJsonSchema(searchSchema),
				},
				{
					name: 'core_get_integration_accounts',
					description: 'List all connected integration accounts',
					inputSchema: zodToJsonSchema(z.object({})),
				},
				{
					name: 'core_get_integration_actions',
					description: 'Get available actions for an integration account',
					inputSchema: zodToJsonSchema(getIntegrationActionsSchema),
				},
				{
					name: 'core_execute_integration_action',
					description: 'Execute an action on an integration account',
					inputSchema: zodToJsonSchema(executeIntegrationActionSchema),
				},
			],
		};
	});

	// Handle tool calls
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;

		try {
			const client = getCoreClient();

			switch (name) {
				case 'core_search': {
					const params = searchSchema.parse(args);
					const result = await client.search(params);
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}

				case 'core_get_integration_accounts': {
					const result = await client.getIntegrationsConnected();
					const accounts = result.accounts || [];
					const formatted = accounts
						.map(
							(account) =>
								`ID: ${account.id}\nName: ${account.name || 'N/A'}\nSlug: ${account.slug || 'N/A'}`,
						)
						.join('\n\n');
					return {
						content: [
							{
								type: 'text',
								text: `Found ${accounts.length} integration accounts:\n\n${formatted}`,
							},
						],
					};
				}

				case 'core_get_integration_actions': {
					const params = getIntegrationActionsSchema.parse(args);
					const result = await client.getIntegrationActions(params);
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}

				case 'core_execute_integration_action': {
					const params = executeIntegrationActionSchema.parse(args);
					const result = await client.executeIntegrationAction(params);
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}

				default:
					return {
						content: [
							{
								type: 'text',
								text: `Unknown tool: ${name}`,
							},
						],
						isError: true,
					};
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error occurred';
			return {
				content: [
					{
						type: 'text',
						text: `Error: ${errorMessage}`,
					},
				],
				isError: true,
			};
		}
	});

	// Start server with stdio transport
	const transport = new StdioServerTransport();
	await server.connect(transport);

	// Keep the process running
	process.stdin.resume();
}
