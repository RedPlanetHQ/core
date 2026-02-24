import zod from 'zod';
import {
	browserOpen,
	browserClose,
	browserCommand,
	browserGetSessions,
	browserCloseAll,
	isBlockedCommand,
	getMaxSessions,
	createSession,
	deleteSession,
} from '@/utils/agent-browser';

// ============ Zod Schemas ============

export const BrowserOpenSchema = zod.object({
	url: zod.string().describe('URL to open'),
	sessionName: zod
		.string()
		.optional()
		.default('corebrain')
		.describe('Session name (must be pre-configured, default: corebrain)'),
});

export const BrowserCloseSchema = zod.object({
	sessionName: zod.string().describe('Session name to close'),
});

export const BrowserCommandSchema = zod.object({
	sessionName: zod.string().describe('Session name to run command on'),
	command: zod
		.string()
		.describe('Command to run (e.g., click, fill, type, screenshot, etc.)'),
	args: zod
		.array(zod.string())
		.optional()
		.default([])
		.describe('Command arguments'),
});

export const BrowserGetSessionsSchema = zod.object({});

export const BrowserCloseAllSchema = zod.object({});

export const BrowserCreateSessionSchema = zod.object({
	name: zod.string().describe('Session name to create (alphanumeric, hyphens, underscores only)'),
});

export const BrowserDeleteSessionSchema = zod.object({
	name: zod.string().describe('Session name to delete'),
});

// ============ Tool Interface ============

export interface GatewayTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

// ============ JSON Schemas ============

const jsonSchemas: Record<string, Record<string, unknown>> = {
	browser_open: {
		type: 'object',
		properties: {
			url: {type: 'string', description: 'URL to open'},
			sessionName: {
				type: 'string',
				description:
					'Session name (must be pre-configured). Default: corebrain. Use browser_list_sessions to see available sessions.',
			},
		},
		required: ['url'],
	},
	browser_close: {
		type: 'object',
		properties: {
			sessionName: {type: 'string', description: 'Session name to close'},
		},
		required: ['sessionName'],
	},
	browser_command: {
		type: 'object',
		properties: {
			sessionName: {
				type: 'string',
				description: 'Session name to run command on',
			},
			command: {
				type: 'string',
				description:
					'Command to run. Available: click, dblclick, fill, type, press, hover, select, check, uncheck, scroll, screenshot, snapshot, eval, get, is, find, wait, mouse, set, tab, frame, back, forward, reload. Blocked: open, close, cookies, storage, network, download, run, session, task, tunnel, state',
			},
			args: {
				type: 'array',
				items: {type: 'string'},
				description: 'Command arguments (selector, text, etc.)',
			},
		},
		required: ['sessionName', 'command'],
	},
	browser_list_sessions: {
		type: 'object',
		properties: {},
		required: [],
		description: 'List all configured browser sessions',
	},
	browser_close_all: {
		type: 'object',
		properties: {},
		required: [],
		description: 'Close all configured browser sessions',
	},
	browser_create_session: {
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description: 'Session name to create (alphanumeric, hyphens, underscores only)',
			},
		},
		required: ['name'],
	},
	browser_delete_session: {
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description: 'Session name to delete',
			},
		},
		required: ['name'],
	},
};

// ============ Tool Definitions ============

export const browserTools: GatewayTool[] = [
	{
		name: 'browser_open',
		description:
			'Open a browser with a URL using a pre-configured session. Sessions must be created first with browser_create_session. Use browser_list_sessions to see available sessions.',
		inputSchema: jsonSchemas.browser_open!,
	},
	{
		name: 'browser_close',
		description: 'Close a browser for the specified session',
		inputSchema: jsonSchemas.browser_close!,
	},
	{
		name: 'browser_command',
		description:
			'Run a browser command on a session. Commands: click, dblclick, fill, type, press, hover, select, check, uncheck, scroll, screenshot, snapshot, eval, get, is, find, wait, mouse, set, tab, frame, back, forward, reload',
		inputSchema: jsonSchemas.browser_command!,
	},
	{
		name: 'browser_list_sessions',
		description: `List all configured browser sessions. Maximum ${getMaxSessions()} sessions allowed.`,
		inputSchema: jsonSchemas.browser_list_sessions!,
	},
	{
		name: 'browser_close_all',
		description: 'Close all configured browser sessions at once.',
		inputSchema: jsonSchemas.browser_close_all!,
	},
	{
		name: 'browser_create_session',
		description: `Create a new browser session. Session names must be alphanumeric with hyphens/underscores. Maximum ${getMaxSessions()} sessions allowed.`,
		inputSchema: jsonSchemas.browser_create_session!,
	},
	{
		name: 'browser_delete_session',
		description: 'Delete a browser session. This closes the browser and removes the session configuration.',
		inputSchema: jsonSchemas.browser_delete_session!,
	},
];

// ============ Tool Execution ============

export async function executeBrowserTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	try {
		switch (toolName) {
			case 'browser_open': {
				const p = BrowserOpenSchema.parse(params);
				const r = await browserOpen(p.url, p.sessionName);
				if (r.code !== 0) {
					return {success: false, error: r.stderr || 'Failed to open browser'};
				}
				return {
					success: true,
					result: {
						message: `Opened ${p.url} with session "${p.sessionName}"`,
						sessionName: p.sessionName,
					},
				};
			}

			case 'browser_close': {
				const p = BrowserCloseSchema.parse(params);
				const r = await browserClose(p.sessionName);
				if (r.code !== 0) {
					return {success: false, error: r.stderr || 'Failed to close browser'};
				}
				return {
					success: true,
					result: {message: `Closed browser for session "${p.sessionName}"`},
				};
			}

			case 'browser_command': {
				const p = BrowserCommandSchema.parse(params);

				// Check if command is blocked before executing
				if (isBlockedCommand(p.command)) {
					return {
						success: false,
						error: `Command "${p.command}" is blocked. Use browser_open or browser_close instead for open/close, other blocked commands are not available.`,
					};
				}

				const r = await browserCommand(p.sessionName, p.command, p.args);
				if (r.code !== 0) {
					return {
						success: false,
						error: r.stderr || `Failed to run "${p.command}"`,
					};
				}
				return {
					success: true,
					result: {
						message: `Executed "${p.command}" on session "${p.sessionName}"`,
						output: r.stdout,
					},
				};
			}

			case 'browser_list_sessions': {
				BrowserGetSessionsSchema.parse(params);
				const sessions = browserGetSessions();
				const maxSessions = getMaxSessions();
				return {
					success: true,
					result: {
						sessions,
						count: sessions.length,
						maxSessions,
					},
				};
			}

			case 'browser_close_all': {
				BrowserCloseAllSchema.parse(params);
				const r = await browserCloseAll();
				if (r.code !== 0) {
					return {
						success: false,
						error: r.stderr || 'Failed to close all browsers',
					};
				}
				return {
					success: true,
					result: {message: 'Closed all browser sessions', details: r.stdout},
				};
			}

			case 'browser_create_session': {
				const p = BrowserCreateSessionSchema.parse(params);
				const r = createSession(p.name);
				if (!r.success) {
					return {success: false, error: r.error || 'Failed to create session'};
				}
				const sessions = browserGetSessions();
				return {
					success: true,
					result: {
						message: `Created session "${p.name}"`,
						sessions,
						count: sessions.length,
						maxSessions: getMaxSessions(),
					},
				};
			}

			case 'browser_delete_session': {
				const p = BrowserDeleteSessionSchema.parse(params);
				// First close the browser
				await browserClose(p.name);
				// Then delete from config
				const r = deleteSession(p.name);
				if (!r.success) {
					return {success: false, error: r.error || 'Failed to delete session'};
				}
				const sessions = browserGetSessions();
				return {
					success: true,
					result: {
						message: `Deleted session "${p.name}"`,
						sessions,
						count: sessions.length,
						maxSessions: getMaxSessions(),
					},
				};
			}

			default:
				return {success: false, error: `Unknown tool: ${toolName}`};
		}
	} catch (err) {
		if (err instanceof zod.ZodError) {
			return {success: false, error: `Invalid parameters: ${err.message}`};
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Unknown error',
		};
	}
}
