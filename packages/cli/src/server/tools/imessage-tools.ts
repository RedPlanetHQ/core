import zod from 'zod';
import {execSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import type {GatewayTool} from '@/server/tools/browser-tools';

// ============ Constants ============

const MESSAGES_DB_PATH = join(homedir(), 'Library/Messages/chat.db');

// ============ Zod Schemas ============

export const IMessageGetThreadsSchema = zod.object({
	limit: zod
		.number()
		.optional()
		.default(10)
		.describe('Number of threads to return (default: 10)'),
	sender: zod
		.string()
		.optional()
		.describe('Filter by phone number or email'),
	after: zod
		.string()
		.optional()
		.describe('Filter threads with messages after this date (ISO 8601 or YYYY-MM-DD)'),
	before: zod
		.string()
		.optional()
		.describe('Filter threads with messages before this date (ISO 8601 or YYYY-MM-DD)'),
});

export const IMessageGetMessagesSchema = zod.object({
	threadId: zod.string().describe('Chat identifier (phone number or email)'),
	limit: zod
		.number()
		.optional()
		.default(20)
		.describe('Number of messages to return (default: 20)'),
	after: zod
		.string()
		.optional()
		.describe('Filter messages after this date (ISO 8601 or YYYY-MM-DD)'),
	before: zod
		.string()
		.optional()
		.describe('Filter messages before this date (ISO 8601 or YYYY-MM-DD)'),
	fromMe: zod
		.boolean()
		.optional()
		.describe('Filter by sender: true = only my messages, false = only received'),
});

export const IMessageSearchSchema = zod.object({
	query: zod.string().describe('Text to search for in messages'),
	limit: zod
		.number()
		.optional()
		.default(20)
		.describe('Number of results to return (default: 20)'),
	sender: zod
		.string()
		.optional()
		.describe('Filter by phone number or email'),
	after: zod
		.string()
		.optional()
		.describe('Filter messages after this date (ISO 8601 or YYYY-MM-DD)'),
	before: zod
		.string()
		.optional()
		.describe('Filter messages before this date (ISO 8601 or YYYY-MM-DD)'),
	fromMe: zod
		.boolean()
		.optional()
		.describe('Filter by sender: true = only my messages, false = only received'),
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
			limit: {
				type: 'number',
				description: 'Number of threads to return (default: 10)',
			},
			sender: {
				type: 'string',
				description: 'Filter by phone number or email',
			},
			after: {
				type: 'string',
				description: 'Filter threads with messages after this date (ISO 8601 or YYYY-MM-DD)',
			},
			before: {
				type: 'string',
				description: 'Filter threads with messages before this date (ISO 8601 or YYYY-MM-DD)',
			},
		},
		required: [],
	},
	imessage_get_messages: {
		type: 'object',
		properties: {
			threadId: {
				type: 'string',
				description: 'Chat identifier (phone number or email)',
			},
			limit: {
				type: 'number',
				description: 'Number of messages to return (default: 20)',
			},
			after: {
				type: 'string',
				description: 'Filter messages after this date (ISO 8601 or YYYY-MM-DD)',
			},
			before: {
				type: 'string',
				description: 'Filter messages before this date (ISO 8601 or YYYY-MM-DD)',
			},
			fromMe: {
				type: 'boolean',
				description: 'Filter by sender: true = only my messages, false = only received',
			},
		},
		required: ['threadId'],
	},
	imessage_search: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Text to search for in messages',
			},
			limit: {
				type: 'number',
				description: 'Number of results to return (default: 20)',
			},
			sender: {
				type: 'string',
				description: 'Filter by phone number or email',
			},
			after: {
				type: 'string',
				description: 'Filter messages after this date (ISO 8601 or YYYY-MM-DD)',
			},
			before: {
				type: 'string',
				description: 'Filter messages before this date (ISO 8601 or YYYY-MM-DD)',
			},
			fromMe: {
				type: 'boolean',
				description: 'Filter by sender: true = only my messages, false = only received',
			},
		},
		required: ['query'],
	},
	imessage_send: {
		type: 'object',
		properties: {
			to: {
				type: 'string',
				description: 'Phone number or email to send to',
			},
			message: {
				type: 'string',
				description: 'Message text to send',
			},
		},
		required: ['to', 'message'],
	},
};

// ============ Tool Definitions ============

export const imessageTools: GatewayTool[] = [
	{
		name: 'imessage_get_threads',
		description:
			'Get recent iMessage conversation threads. Can filter by sender, date range.',
		inputSchema: jsonSchemas.imessage_get_threads!,
	},
	{
		name: 'imessage_get_messages',
		description:
			'Get messages from a specific iMessage thread. Can filter by date range and sent/received.',
		inputSchema: jsonSchemas.imessage_get_messages!,
	},
	{
		name: 'imessage_search',
		description:
			'Search iMessage history. Can filter by sender, date range, and sent/received.',
		inputSchema: jsonSchemas.imessage_search!,
	},
	{
		name: 'imessage_send',
		description: 'Send an iMessage to a phone number or email address',
		inputSchema: jsonSchemas.imessage_send!,
	},
];

// ============ Helper Functions ============

function checkDatabaseAccess(): {accessible: boolean; error?: string} {
	if (!existsSync(MESSAGES_DB_PATH)) {
		return {accessible: false, error: 'Messages database not found'};
	}

	try {
		// Try a simple query to check access
		execSync(`sqlite3 "${MESSAGES_DB_PATH}" "SELECT 1 LIMIT 1"`, {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		return {accessible: true};
	} catch {
		return {
			accessible: false,
			error:
				'Cannot access Messages database. Grant Full Disk Access to your terminal in System Settings > Privacy & Security > Full Disk Access',
		};
	}
}

function runQuery(query: string): string {
	return execSync(`sqlite3 -json "${MESSAGES_DB_PATH}" "${query}"`, {
		encoding: 'utf-8',
		maxBuffer: 10 * 1024 * 1024, // 10MB buffer
	});
}

function escapeSQL(str: string): string {
	return str.replace(/'/g, "''");
}

// Convert ISO date string to Apple's CoreData timestamp
// Apple uses nanoseconds since 2001-01-01
function dateToAppleTimestamp(dateStr: string): number {
	const date = new Date(dateStr);
	// Unix epoch to Apple epoch difference in seconds
	const appleEpochOffset = 978307200;
	// Convert to Apple timestamp (nanoseconds since 2001-01-01)
	return (Math.floor(date.getTime() / 1000) - appleEpochOffset) * 1000000000;
}

// ============ Tool Execution ============

export async function executeIMessageTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	// Check database access first
	const accessCheck = checkDatabaseAccess();
	if (!accessCheck.accessible) {
		return {success: false, error: accessCheck.error};
	}

	try {
		switch (toolName) {
			case 'imessage_get_threads': {
				const p = IMessageGetThreadsSchema.parse(params);

				const conditions: string[] = [];

				if (p.sender) {
					const escapedSender = escapeSQL(p.sender);
					conditions.push(`c.chat_identifier LIKE '%${escapedSender}%'`);
				}
				if (p.after) {
					const timestamp = dateToAppleTimestamp(p.after);
					conditions.push(`m.date >= ${timestamp}`);
				}
				if (p.before) {
					const timestamp = dateToAppleTimestamp(p.before);
					conditions.push(`m.date <= ${timestamp}`);
				}

				const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

				const query = `
					SELECT
						c.chat_identifier,
						c.display_name,
						datetime(MAX(m.date)/1000000000 + 978307200, 'unixepoch', 'localtime') as last_message_date,
						COUNT(m.ROWID) as message_count
					FROM chat c
					LEFT JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
					LEFT JOIN message m ON cmj.message_id = m.ROWID
					${whereClause}
					GROUP BY c.ROWID
					ORDER BY MAX(m.date) DESC
					LIMIT ${p.limit}
				`;

				const result = runQuery(query.replace(/\n/g, ' ').replace(/\s+/g, ' '));
				const threads = JSON.parse(result || '[]');

				return {
					success: true,
					result: {
						threads,
						count: threads.length,
						filters: {
							sender: p.sender,
							after: p.after,
							before: p.before,
						},
					},
				};
			}

			case 'imessage_get_messages': {
				const p = IMessageGetMessagesSchema.parse(params);
				const escapedThreadId = escapeSQL(p.threadId);

				const conditions: string[] = [`c.chat_identifier LIKE '%${escapedThreadId}%'`];

				if (p.after) {
					const timestamp = dateToAppleTimestamp(p.after);
					conditions.push(`m.date >= ${timestamp}`);
				}
				if (p.before) {
					const timestamp = dateToAppleTimestamp(p.before);
					conditions.push(`m.date <= ${timestamp}`);
				}
				if (p.fromMe !== undefined) {
					conditions.push(`m.is_from_me = ${p.fromMe ? 1 : 0}`);
				}

				const query = `
					SELECT
						h.id as sender,
						m.text,
						m.is_from_me,
						datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as date,
						m.is_read
					FROM message m
					JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
					JOIN chat c ON cmj.chat_id = c.ROWID
					LEFT JOIN handle h ON m.handle_id = h.ROWID
					WHERE ${conditions.join(' AND ')}
					ORDER BY m.date DESC
					LIMIT ${p.limit}
				`;

				const result = runQuery(query.replace(/\n/g, ' ').replace(/\s+/g, ' '));
				const messages = JSON.parse(result || '[]');

				return {
					success: true,
					result: {
						threadId: p.threadId,
						messages: messages.reverse(), // Chronological order
						count: messages.length,
						filters: {
							after: p.after,
							before: p.before,
							fromMe: p.fromMe,
						},
					},
				};
			}

			case 'imessage_search': {
				const p = IMessageSearchSchema.parse(params);
				const escapedQuery = escapeSQL(p.query);

				const conditions: string[] = [`m.text LIKE '%${escapedQuery}%'`];

				if (p.sender) {
					const escapedSender = escapeSQL(p.sender);
					conditions.push(`(c.chat_identifier LIKE '%${escapedSender}%' OR h.id LIKE '%${escapedSender}%')`);
				}
				if (p.after) {
					const timestamp = dateToAppleTimestamp(p.after);
					conditions.push(`m.date >= ${timestamp}`);
				}
				if (p.before) {
					const timestamp = dateToAppleTimestamp(p.before);
					conditions.push(`m.date <= ${timestamp}`);
				}
				if (p.fromMe !== undefined) {
					conditions.push(`m.is_from_me = ${p.fromMe ? 1 : 0}`);
				}

				const query = `
					SELECT
						c.chat_identifier,
						h.id as sender,
						m.text,
						m.is_from_me,
						datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as date
					FROM message m
					JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
					JOIN chat c ON cmj.chat_id = c.ROWID
					LEFT JOIN handle h ON m.handle_id = h.ROWID
					WHERE ${conditions.join(' AND ')}
					ORDER BY m.date DESC
					LIMIT ${p.limit}
				`;

				const result = runQuery(query.replace(/\n/g, ' ').replace(/\s+/g, ' '));
				const messages = JSON.parse(result || '[]');

				return {
					success: true,
					result: {
						query: p.query,
						messages,
						count: messages.length,
						filters: {
							sender: p.sender,
							after: p.after,
							before: p.before,
							fromMe: p.fromMe,
						},
					},
				};
			}

			case 'imessage_send': {
				const p = IMessageSendSchema.parse(params);
				const escapedTo = p.to.replace(/"/g, '\\"');
				const escapedMessage = p.message.replace(/"/g, '\\"').replace(/'/g, "'\"'\"'");

				const appleScript = `
					tell application "Messages"
						set targetService to 1st account whose service type = iMessage
						set targetBuddy to participant "${escapedTo}" of targetService
						send "${escapedMessage}" to targetBuddy
					end tell
				`;

				try {
					execSync(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`, {
						encoding: 'utf-8',
					});

					return {
						success: true,
						result: {
							message: `Message sent to ${p.to}`,
							to: p.to,
							text: p.message,
						},
					};
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : 'Unknown error';
					return {
						success: false,
						error: `Failed to send message: ${errorMsg}`,
					};
				}
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
