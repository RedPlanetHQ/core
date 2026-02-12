import zod from 'zod';
import {
	browserOpen,
	browserClose,
	browserCommand,
	browserListSessions,
	browserGetProfiles,
	isBlockedCommand,
} from '@/utils/agent-browser';

// ============ Zod Schemas ============

export const BrowserOpenSchema = zod.object({
	session_name: zod.string().describe('Unique session name'),
	url: zod.string().describe('URL to open'),
	profile: zod.string().optional().default('corebrain').describe('Browser profile to use (default: corebrain)'),
});

export const BrowserCloseSchema = zod.object({
	session_name: zod.string().describe('Session name to close'),
});

export const BrowserCommandSchema = zod.object({
	session_name: zod.string().describe('Session name to run command on'),
	command: zod.string().describe('Command to run (e.g., click, fill, type, screenshot, etc.)'),
	args: zod.array(zod.string()).optional().default([]).describe('Command arguments'),
});

export const BrowserListSessionsSchema = zod.object({});

export const BrowserGetProfilesSchema = zod.object({});

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
			session_name: {type: 'string', description: 'Unique session name'},
			url: {type: 'string', description: 'URL to open'},
			profile: {type: 'string', description: 'Browser profile to use (default: corebrain)'},
		},
		required: ['session_name', 'url'],
	},
	browser_close: {
		type: 'object',
		properties: {
			session_name: {type: 'string', description: 'Session name to close'},
		},
		required: ['session_name'],
	},
	browser_command: {
		type: 'object',
		properties: {
			session_name: {type: 'string', description: 'Session name to run command on'},
			command: {
				type: 'string',
				description: 'Command to run. Available: click, dblclick, fill, type, press, hover, select, check, uncheck, scroll, screenshot, snapshot, eval, get, is, find, wait, mouse, set, tab, frame, back, forward, reload. Blocked: open, close, cookies, storage, network, trace, highlight, console, errors, state, download',
			},
			args: {
				type: 'array',
				items: {type: 'string'},
				description: 'Command arguments (selector, text, etc.)',
			},
		},
		required: ['session_name', 'command'],
	},
	browser_list_sessions: {
		type: 'object',
		properties: {},
		required: [],
		description: 'List all active browser sessions (max 3)',
	},
	browser_get_profiles: {
		type: 'object',
		properties: {},
		required: [],
		description: 'List all available browser profiles',
	},
};

// ============ Tool Definitions ============

export const browserTools: GatewayTool[] = [
	{
		name: 'browser_open',
		description: 'Open a browser session with a URL. Creates profile if it doesn\'t exist. Max 3 concurrent sessions.',
		inputSchema: jsonSchemas.browser_open!,
	},
	{
		name: 'browser_close',
		description: 'Close a browser session',
		inputSchema: jsonSchemas.browser_close!,
	},
	{
		name: 'browser_command',
		description: 'Run a browser command on a session. Commands: click, dblclick, fill, type, press, hover, select, check, uncheck, scroll, screenshot, snapshot, eval, get, is, find, wait, mouse, set, tab, frame, back, forward, reload',
		inputSchema: jsonSchemas.browser_command!,
	},
	{
		name: 'browser_list_sessions',
		description: 'List all active browser sessions',
		inputSchema: jsonSchemas.browser_list_sessions!,
	},
	{
		name: 'browser_get_profiles',
		description: 'List all available browser profiles',
		inputSchema: jsonSchemas.browser_get_profiles!,
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
				const r = await browserOpen(p.session_name, p.url, p.profile);
				if (r.code !== 0) {
					return {success: false, error: r.stderr || 'Failed to open browser'};
				}
				return {
					success: true,
					result: {
						message: `Opened ${p.url} in session "${p.session_name}"`,
						session_name: p.session_name,
						profile: p.profile,
					},
				};
			}

			case 'browser_close': {
				const p = BrowserCloseSchema.parse(params);
				const r = await browserClose(p.session_name);
				if (r.code !== 0) {
					return {success: false, error: r.stderr || 'Failed to close browser'};
				}
				return {
					success: true,
					result: {message: `Closed session "${p.session_name}"`},
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

				const r = await browserCommand(p.session_name, p.command, p.args);
				if (r.code !== 0) {
					return {success: false, error: r.stderr || `Failed to run "${p.command}"`};
				}
				return {
					success: true,
					result: {
						message: `Executed "${p.command}" on session "${p.session_name}"`,
						output: r.stdout,
					},
				};
			}

			case 'browser_list_sessions': {
				BrowserListSessionsSchema.parse(params);
				const sessions = browserListSessions();
				return {
					success: true,
					result: {
						sessions,
						count: sessions.length,
						max_sessions: 3,
					},
				};
			}

			case 'browser_get_profiles': {
				BrowserGetProfilesSchema.parse(params);
				const profiles = browserGetProfiles();
				return {
					success: true,
					result: {profiles},
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
