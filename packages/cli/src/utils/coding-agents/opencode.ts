import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {
	BaseCodingAgentReader,
	type AgentReadResult,
	type AgentReadOptions,
	type AgentTurnsResult,
	type ConversationTurn,
	type ScannedSession,
	type ScanOptions,
	type SessionEntry,
} from './types';

const _require = createRequire(import.meta.url);

// ─── Minimal SQLite interface (node:sqlite, Node 22.5+) ──────────────────────

interface SQLiteRow extends Record<string, unknown> {}
interface SQLiteStatement {
	all(...args: unknown[]): SQLiteRow[];
	get(...args: unknown[]): SQLiteRow | undefined;
}
interface SQLiteDatabase {
	prepare(sql: string): SQLiteStatement;
	close(): void;
}

// ─── Database path ────────────────────────────────────────────────────────────

/**
 * OpenCode stores its SQLite database at $XDG_DATA_HOME/opencode/opencode.db.
 * On most Linux and macOS installs XDG_DATA_HOME defaults to ~/.local/share.
 */
function getDbPath(): string {
	const dataHome =
		process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share');
	return join(dataHome, 'opencode', 'opencode.db');
}

function tryOpenDb(): SQLiteDatabase | null {
	const dbPath = getDbPath();
	if (!existsSync(dbPath)) return null;
	try {
		const {DatabaseSync} = _require('node:sqlite') as {
			DatabaseSync: new (
				path: string,
				opts?: {readOnly?: boolean},
			) => SQLiteDatabase;
		};
		return new DatabaseSync(dbPath, {readOnly: true});
	} catch {
		return null;
	}
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function parseJson(raw: unknown): Record<string, unknown> | null {
	if (typeof raw !== 'string') return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return typeof parsed === 'object' &&
			parsed !== null &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function extractRole(
	msgData: Record<string, unknown>,
): 'user' | 'assistant' | null {
	const role = msgData['role'];
	if (role === 'user' || role === 'assistant') return role;
	return null;
}

function extractTextFromPart(partData: Record<string, unknown>): string | null {
	if (partData['type'] === 'text' && typeof partData['text'] === 'string') {
		return (partData['text'] as string).trim() || null;
	}
	return null;
}

function formatToolPart(partData: Record<string, unknown>): string | null {
	if (partData['type'] === 'tool-invocation') {
		const inv = partData['toolInvocation'] as
			| Record<string, unknown>
			| undefined;
		if (inv && typeof inv['toolName'] === 'string') {
			const name = inv['toolName'] as string;
			const args = inv['args'] as Record<string, unknown> | undefined;
			const primaryArg = args
				? Object.values(args).find(
						(v) => typeof v === 'string' && (v as string).length > 0,
					)
				: undefined;
			const hint =
				typeof primaryArg === 'string'
					? ` ${(primaryArg as string).slice(0, 80)}`
					: '';
			return `[${name}]${hint}`;
		}
	}
	return null;
}

// ─── Row types ────────────────────────────────────────────────────────────────

interface SessionRow extends SQLiteRow {
	id: string;
	directory: string;
	title: string;
	time_created: number;
	time_updated: number;
}

interface MessagePartRow extends SQLiteRow {
	message_id: string;
	message_data: string;
	message_time: number;
	part_id: string | null;
	part_data: string | null;
	part_time: number | null;
}

// ─── Public export: session discovery after spawn ────────────────────────────

/**
 * After spawning opencode for a new session, poll the SQLite database for a
 * session whose `directory` matches `dir` and was created after `startedAfter`.
 * Returns the opencode-assigned session ID on success, null on timeout (15 s).
 */
export async function findLatestOpenCodeSession(
	dir: string,
	startedAfter: number,
): Promise<{sessionId: string} | null> {
	// Allow a small buffer in case the session row was written just before our
	// timestamp was captured.
	const cutoff = startedAfter - 2_000;
	const deadline = Date.now() + 15_000;

	async function scan(): Promise<{sessionId: string} | null> {
		const db = tryOpenDb();
		if (!db) return null;
		try {
			const rows = db
				.prepare(
					`SELECT id FROM session
           WHERE directory = ? AND time_created >= ?
           ORDER BY time_created DESC
           LIMIT 5`,
				)
				.all(dir, cutoff) as SessionRow[];
			if (rows.length > 0) return {sessionId: rows[0]!.id};
		} catch {
			/* ignore */
		} finally {
			try {
				db.close();
			} catch {
				/* ignore */
			}
		}

		return null;
	}

	while (Date.now() < deadline) {
		const result = await scan();
		if (result) return result;
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 500);
		});
	}

	return null;
}

// ─── Reader ───────────────────────────────────────────────────────────────────

export class OpenCodeReader extends BaseCodingAgentReader {
	readonly agentName = 'opencode';

	sessionExists(_dir: string, sessionId: string): boolean {
		const db = tryOpenDb();
		if (!db) return false;
		try {
			const row = db
				.prepare('SELECT 1 FROM session WHERE id = ? LIMIT 1')
				.get(sessionId);
			return row !== undefined;
		} catch {
			return false;
		} finally {
			try {
				db.close();
			} catch {
				/* ignore */
			}
		}
	}

	sessionUpdatedSince(_dir: string, sessionId: string, since: number): boolean {
		const db = tryOpenDb();
		if (!db) return false;
		try {
			const row = db
				.prepare(
					'SELECT 1 FROM session WHERE id = ? AND time_updated > ? LIMIT 1',
				)
				.get(sessionId, since);
			return row !== undefined;
		} catch {
			return false;
		} finally {
			try {
				db.close();
			} catch {
				/* ignore */
			}
		}
	}

	async readSessionOutput(
		_dir: string,
		sessionId: string,
		options: AgentReadOptions = {},
	): Promise<AgentReadResult> {
		const empty: AgentReadResult = {
			entries: [],
			totalLines: 0,
			returnedLines: 0,
			fileExists: false,
			fileSizeBytes: 0,
			fileSizeHuman: '0 B',
		};

		const db = tryOpenDb();
		if (!db) return empty;

		try {
			// Verify the session exists before reading messages
			const sess = db
				.prepare('SELECT id FROM session WHERE id = ? LIMIT 1')
				.get(sessionId) as SessionRow | undefined;
			if (!sess) return empty;

			const rows = db
				.prepare(
					`SELECT
            m.id         AS message_id,
            m.data       AS message_data,
            m.time_created AS message_time,
            p.id         AS part_id,
            p.data       AS part_data,
            p.time_created AS part_time
          FROM message m
          LEFT JOIN part p ON p.message_id = m.id
          WHERE m.session_id = ?
          ORDER BY m.time_created, p.time_created`,
				)
				.all(sessionId) as MessagePartRow[];

			// Group parts by message, preserving message insertion order
			const messageOrder: string[] = [];
			const messageMap = new Map<
				string,
				{
					msgData: string;
					msgTime: number;
					parts: Array<{partData: string; partTime: number}>;
				}
			>();

			for (const row of rows) {
				if (!messageMap.has(row.message_id)) {
					messageMap.set(row.message_id, {
						msgData: row.message_data,
						msgTime: row.message_time,
						parts: [],
					});
					messageOrder.push(row.message_id);
				}

				if (row.part_id && row.part_data !== null) {
					messageMap.get(row.message_id)!.parts.push({
						partData: row.part_data,
						partTime: row.part_time ?? 0,
					});
				}
			}

			// Convert to SessionEntry[]
			const allEntries: SessionEntry[] = [];

			for (const msgId of messageOrder) {
				const msg = messageMap.get(msgId)!;
				const parsedMsg = parseJson(msg.msgData);
				if (!parsedMsg) continue;
				const role = extractRole(parsedMsg);
				if (!role) continue;

				const contentParts: string[] = [];
				for (const {partData} of msg.parts) {
					const parsedPart = parseJson(partData);
					if (!parsedPart) continue;
					const text = extractTextFromPart(parsedPart);
					if (text) contentParts.push(text);
					if (role === 'assistant') {
						const tool = formatToolPart(parsedPart);
						if (tool) contentParts.push(tool);
					}
				}

				const content = contentParts.join('\n').trim();
				if (!content) continue;

				allEntries.push({
					type: role,
					message: {role, content},
					timestamp: new Date(msg.msgTime).toISOString(),
				});
			}

			const totalLines = allEntries.length;
			let entries: SessionEntry[];

			if (options.tail && options.lines) {
				entries = allEntries.slice(Math.max(0, totalLines - options.lines));
			} else if (options.lines !== undefined || options.offset !== undefined) {
				const offset = options.offset ?? 0;
				const limit = options.lines ?? totalLines;
				entries = allEntries.slice(offset, offset + limit);
			} else {
				entries = allEntries;
			}

			return {
				entries,
				totalLines,
				returnedLines: entries.length,
				fileExists: true,
				fileSizeBytes: 0,
				fileSizeHuman: '0 B',
			};
		} catch (err) {
			return {
				...empty,
				fileExists: true,
				error: err instanceof Error ? err.message : 'Failed to read session',
			};
		} finally {
			try {
				db.close();
			} catch {
				/* ignore */
			}
		}
	}

	async readSessionTurns(
		dir: string,
		sessionId: string,
		options: AgentReadOptions = {},
	): Promise<AgentTurnsResult> {
		const result = await this.readSessionOutput(dir, sessionId, options);
		const turns: ConversationTurn[] = [];
		for (const e of result.entries) {
			const role = e.message?.role;
			if (role !== 'user' && role !== 'assistant') continue;
			const content =
				typeof e.message!.content === 'string' ? e.message!.content : '';
			turns.push({role: role as 'user' | 'assistant', content});
		}

		return {
			turns,
			totalLines: result.totalLines,
			fileExists: result.fileExists,
			fileSizeBytes: result.fileSizeBytes,
			fileSizeHuman: result.fileSizeHuman,
			error: result.error,
		};
	}

	async scanSessions(options: ScanOptions = {}): Promise<ScannedSession[]> {
		const db = tryOpenDb();
		if (!db) return [];

		try {
			let query = `
        SELECT id, directory, title, time_created, time_updated
        FROM session
        WHERE time_archived IS NULL
      `;
			const params: unknown[] = [];

			if (options.dir) {
				query += ' AND directory = ?';
				params.push(options.dir);
			}

			if (options.since) {
				query += ' AND time_updated >= ?';
				params.push(options.since);
			}

			query += ' ORDER BY time_updated DESC';

			const rows = db.prepare(query).all(...params) as SessionRow[];

			return rows.map((row) => ({
				sessionId: row.id,
				agent: this.agentName,
				dir: row.directory,
				title: row.title || null,
				filePath: getDbPath(),
				fileSizeBytes: 0,
				createdAt: row.time_created,
				updatedAt: row.time_updated,
				turnCount: 0,
			}));
		} catch {
			return [];
		} finally {
			try {
				db.close();
			} catch {
				/* ignore */
			}
		}
	}
}

export const opencodeReader = new OpenCodeReader();
