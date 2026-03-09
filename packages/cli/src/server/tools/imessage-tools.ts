import zod from 'zod';
import {execSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {GatewayTool} from '@/server/tools/browser-tools';

// ============ Constants ============

const DB_PATH = join(homedir(), 'Library/Messages/chat.db');

// ============ Zod Schemas ============

export const IMessageGetThreadsSchema = zod.object({
	limit: zod.number().optional().default(10).describe('Number of threads to return (default: 10)'),
	sender: zod.string().optional().describe('Filter by phone number or sender ID (partial match)'),
	after: zod.string().optional().describe('Filter threads active after this date (ISO 8601 or YYYY-MM-DD)'),
	before: zod.string().optional().describe('Filter threads active before this date (ISO 8601 or YYYY-MM-DD)'),
});

export const IMessageGetMessagesSchema = zod.object({
	threadId: zod.string().describe('Chat identifier (phone number, email, or sender ID)'),
	limit: zod.number().optional().default(20).describe('Number of messages to return (default: 20)'),
	after: zod.string().optional().describe('Filter messages after this date (ISO 8601 or YYYY-MM-DD)'),
	before: zod.string().optional().describe('Filter messages before this date (ISO 8601 or YYYY-MM-DD)'),
	fromMe: zod.boolean().optional().describe('true = only sent, false = only received'),
});

export const IMessageSearchSchema = zod.object({
	query: zod.string().describe('Text to search for in messages'),
	limit: zod.number().optional().default(20).describe('Number of results to return (default: 20)'),
	after: zod.string().optional().describe('Search messages after this date — recommended to limit scope (ISO 8601 or YYYY-MM-DD)'),
	before: zod.string().optional().describe('Search messages before this date — recommended to limit scope (ISO 8601 or YYYY-MM-DD)'),
	sender: zod.string().optional().describe('Limit search to a specific sender (partial match)'),
	fromMe: zod.boolean().optional().describe('true = only sent messages, false = only received'),
});

export const IMessageSendSchema = zod.object({
	to: zod.string().describe('Phone number or email to send to'),
	message: zod.string().describe('Message text to send'),
});

// ============ JSON Schemas ============

const jsonSchemas: Record<string, Record<string, unknown>> = {
	imessage_get_threads: {
		type: 'object',
		properties: {
			limit: {type: 'number', description: 'Number of threads to return (default: 10)'},
			sender: {type: 'string', description: 'Filter by phone number or sender ID (partial match)'},
			after: {type: 'string', description: 'Filter threads active after this date (ISO 8601 or YYYY-MM-DD)'},
			before: {type: 'string', description: 'Filter threads active before this date (ISO 8601 or YYYY-MM-DD)'},
		},
		required: [],
	},
	imessage_get_messages: {
		type: 'object',
		properties: {
			threadId: {type: 'string', description: 'Chat identifier (phone number, email, or sender ID)'},
			limit: {type: 'number', description: 'Number of messages to return (default: 20)'},
			after: {type: 'string', description: 'Filter messages after this date (ISO 8601 or YYYY-MM-DD)'},
			before: {type: 'string', description: 'Filter messages before this date (ISO 8601 or YYYY-MM-DD)'},
			fromMe: {type: 'boolean', description: 'true = only sent, false = only received'},
		},
		required: ['threadId'],
	},
	imessage_search: {
		type: 'object',
		properties: {
			query: {type: 'string', description: 'Text to search for in messages'},
			limit: {type: 'number', description: 'Number of results to return (default: 20)'},
			after: {type: 'string', description: 'Search messages after this date — recommended to limit scope (ISO 8601 or YYYY-MM-DD)'},
			before: {type: 'string', description: 'Search messages before this date — recommended to limit scope (ISO 8601 or YYYY-MM-DD)'},
			sender: {type: 'string', description: 'Limit search to a specific sender (partial match)'},
			fromMe: {type: 'boolean', description: 'true = only sent messages, false = only received'},
		},
		required: ['query'],
	},
	imessage_send: {
		type: 'object',
		properties: {
			to: {type: 'string', description: 'Phone number or email to send to'},
			message: {type: 'string', description: 'Message text to send'},
		},
		required: ['to', 'message'],
	},
};

// ============ Tool Definitions ============

export const imessageTools: GatewayTool[] = [
	{
		name: 'imessage_get_threads',
		description: 'Get recent iMessage/SMS conversation threads. Can filter by sender and date range.',
		inputSchema: jsonSchemas.imessage_get_threads!,
	},
	{
		name: 'imessage_get_messages',
		description: 'Get messages from a specific thread by sender ID, phone number, or email. Can filter by date range and sent/received.',
		inputSchema: jsonSchemas.imessage_get_messages!,
	},
	{
		name: 'imessage_search',
		description: 'Search iMessage/SMS history by text. Use after/before to limit scope. Works for SMS too.',
		inputSchema: jsonSchemas.imessage_search!,
	},
	{
		name: 'imessage_send',
		description: 'Send an iMessage to a phone number or email address.',
		inputSchema: jsonSchemas.imessage_send!,
	},
];

// ============ Query Runner ============
// Uses osascript "do shell script" to run sqlite3 under the user's login session.
// This only requires Automation permission (one-time popup) — no Full Disk Access needed.

function runSQL(sql: string): unknown[] {
	// Base64-encode SQL to avoid all shell quoting/escaping issues.
	// The gateway runs via CoreBrainGateway.app which has Full Disk Access —
	// so we pipe directly to sqlite3 without any osascript wrapper.
	const b64 = Buffer.from(sql).toString('base64');
	let output: string;
	try {
		output = execSync(
			`echo "${b64}" | base64 -d | sqlite3 -json "${DB_PATH}"`,
			{encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024},
		).trim();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('authorization denied') || msg.includes('unable to open')) {
			throw new Error(
				'Full Disk Access required for iMessage tools. Run: corebrain gateway config and re-enable iMessage to complete setup.',
			);
		}
		throw new Error(`iMessage query failed: ${msg}`);
	}

	return output ? (JSON.parse(output) as unknown[]) : [];
}

function escapeSQL(str: string): string {
	return str.replace(/'/g, "''");
}

// Convert ISO/YYYY-MM-DD date to Apple CoreData nanosecond timestamp
function toAppleTs(dateStr: string): number {
	const secs = Math.floor(new Date(dateStr).getTime() / 1000);
	return (secs - 978307200) * 1_000_000_000;
}

// ============ Tool Execution ============

export async function executeIMessageTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	try {
		switch (toolName) {
			case 'imessage_get_threads': {
				const p = IMessageGetThreadsSchema.parse(params);
				const conditions: string[] = [];

				if (p.sender) {
					conditions.push(`c.chat_identifier LIKE '%${escapeSQL(p.sender)}%'`);
				}
				if (p.after) {
					conditions.push(`m.date >= ${toAppleTs(p.after)}`);
				}
				if (p.before) {
					conditions.push(`m.date <= ${toAppleTs(p.before)}`);
				}

				const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

				const sql = `
					SELECT
						c.chat_identifier,
						c.display_name,
						datetime(MAX(m.date)/1000000000 + 978307200, 'unixepoch', 'localtime') AS last_message_date,
						COUNT(m.ROWID) AS message_count
					FROM chat c
					LEFT JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
					LEFT JOIN message m ON cmj.message_id = m.ROWID
					${where}
					GROUP BY c.ROWID
					ORDER BY MAX(m.date) DESC
					LIMIT ${p.limit}
				`;

				const threads = runSQL(sql);
				return {success: true, result: {threads, count: threads.length}};
			}

			case 'imessage_get_messages': {
				const p = IMessageGetMessagesSchema.parse(params);
				const conditions: string[] = [
					`c.chat_identifier LIKE '%${escapeSQL(p.threadId)}%'`,
				];

				if (p.after) conditions.push(`m.date >= ${toAppleTs(p.after)}`);
				if (p.before) conditions.push(`m.date <= ${toAppleTs(p.before)}`);
				if (p.fromMe !== undefined) conditions.push(`m.is_from_me = ${p.fromMe ? 1 : 0}`);

				const sql = `
					SELECT
						COALESCE(h.id, 'me') AS sender,
						m.text,
						m.is_from_me,
						datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') AS date,
						m.is_read
					FROM message m
					JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
					JOIN chat c ON cmj.chat_id = c.ROWID
					LEFT JOIN handle h ON m.handle_id = h.ROWID
					WHERE ${conditions.join(' AND ')}
					ORDER BY m.date DESC
					LIMIT ${p.limit}
				`;

				const messages = runSQL(sql);
				return {
					success: true,
					result: {
						threadId: p.threadId,
						messages: messages.reverse(),
						count: messages.length,
					},
				};
			}

			case 'imessage_search': {
				const p = IMessageSearchSchema.parse(params);
				const conditions: string[] = [
					`m.text LIKE '%${escapeSQL(p.query)}%'`,
				];

				if (p.sender) {
					conditions.push(
						`(c.chat_identifier LIKE '%${escapeSQL(p.sender)}%' OR h.id LIKE '%${escapeSQL(p.sender)}%')`,
					);
				}
				if (p.after) conditions.push(`m.date >= ${toAppleTs(p.after)}`);
				if (p.before) conditions.push(`m.date <= ${toAppleTs(p.before)}`);
				if (p.fromMe !== undefined) conditions.push(`m.is_from_me = ${p.fromMe ? 1 : 0}`);

				const sql = `
					SELECT
						c.chat_identifier,
						COALESCE(h.id, 'me') AS sender,
						m.text,
						m.is_from_me,
						datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') AS date
					FROM message m
					JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
					JOIN chat c ON cmj.chat_id = c.ROWID
					LEFT JOIN handle h ON m.handle_id = h.ROWID
					WHERE ${conditions.join(' AND ')}
					ORDER BY m.date DESC
					LIMIT ${p.limit}
				`;

				const messages = runSQL(sql);
				return {success: true, result: {query: p.query, messages, count: messages.length}};
			}

			case 'imessage_send': {
				const p = IMessageSendSchema.parse(params);
				const to = p.to.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
				const msg = p.message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

				const script = [
					'tell application "Messages"',
					'set targetService to 1st account whose service type = iMessage',
					`set targetBuddy to participant "${to}" of targetService`,
					`send "${msg}" to targetBuddy`,
					'end tell',
				].join('\n');

				execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {encoding: 'utf-8'});

				return {
					success: true,
					result: {message: `Message sent to ${p.to}`, to: p.to, text: p.message},
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
