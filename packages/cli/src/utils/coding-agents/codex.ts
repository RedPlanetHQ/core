import {existsSync, statSync, readdirSync, createReadStream} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createInterface} from 'node:readline';
import {getSessionLogPath} from '@/utils/coding-runner';
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

// ~/.codex/sessions/YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl
const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');

/**
 * Extract the session UUID from a codex rollout filename.
 * rollout-2025-11-03T22-52-20-019a4abd-bd5b-7ab0-aee6-f2fbdcab989c.jsonl
 *                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 */
function extractSessionId(filename: string): string | null {
	const match = filename.match(/^rollout-.*?T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/);
	return match?.[1] ?? null;
}

/**
 * Read the first JSONL line from a file and parse it.
 */
async function readFirstLine(filePath: string): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		const rl = createInterface({input: createReadStream(filePath), crlfDelay: Infinity});
		let done = false;
		rl.on('line', (line) => {
			if (done || !line.trim()) return;
			done = true;
			rl.close();
			try {
				resolve(JSON.parse(line));
			} catch {
				resolve(null);
			}
		});
		rl.on('close', () => { if (!done) resolve(null); });
		rl.on('error', () => resolve(null));
	});
}

/**
 * Walk ~/.codex/sessions/YYYY/MM/DD/ and yield rollout JSONL files (newest first).
 */
function* walkCodexSessions(
	since?: number,
): Generator<{filePath: string; sessionId: string}> {
	if (!existsSync(CODEX_SESSIONS_DIR)) return;

	let years: string[];
	try {
		years = readdirSync(CODEX_SESSIONS_DIR).filter((y) => /^\d{4}$/.test(y));
	} catch {
		return;
	}

	for (const year of years.sort().reverse()) {
		const yearPath = join(CODEX_SESSIONS_DIR, year);
		let months: string[];
		try {
			months = readdirSync(yearPath).filter((m) => /^\d{2}$/.test(m));
		} catch {
			continue;
		}

		for (const month of months.sort().reverse()) {
			const monthPath = join(yearPath, month);
			let days: string[];
			try {
				days = readdirSync(monthPath).filter((d) => /^\d{2}$/.test(d));
			} catch {
				continue;
			}

			for (const day of days.sort().reverse()) {
				if (since) {
					const dateMs = new Date(`${year}-${month}-${day}`).getTime();
					if (dateMs < since - 86_400_000) continue;
				}

				const dayPath = join(monthPath, day);
				let files: string[];
				try {
					files = readdirSync(dayPath)
						.filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl'));
				} catch {
					continue;
				}

				for (const file of files.sort().reverse()) {
					const sessionId = extractSessionId(file);
					if (!sessionId) continue;
					yield {filePath: join(dayPath, file), sessionId};
				}
			}
		}
	}
}

/**
 * Find the JSONL file path for a codex session UUID.
 */
function findSessionPath(sessionId: string): string | null {
	for (const {filePath, sessionId: id} of walkCodexSessions()) {
		if (id === sessionId) return filePath;
	}
	return null;
}

/**
 * After spawning codex, poll until a new JSONL file appears in ~/.codex/sessions
 * whose session_meta.payload.cwd matches `dir` and was created after `startedAfter`.
 * Polls every 500ms, times out after 10 seconds.
 */
export async function findLatestCodexSession(
	dir: string,
	startedAfter: number,
): Promise<{sessionId: string; filePath: string} | null> {
	// Allow a small buffer in case the file was created just before our timestamp
	const cutoff = startedAfter - 2_000;
	const deadline = Date.now() + 10_000;

	async function scan(): Promise<{sessionId: string; filePath: string} | null> {
		for (const {filePath, sessionId} of walkCodexSessions()) {
			let stats;
			try {
				stats = statSync(filePath);
			} catch {
				continue;
			}

			// Stop scanning once files are older than our start time
			if (stats.mtimeMs < cutoff) break;

			const first = await readFirstLine(filePath);
			if (first?.type === 'session_meta') {
				const cwd = (first.payload as any)?.cwd;
				if (cwd === dir) return {sessionId, filePath};
			}
		}
		return null;
	}

	while (Date.now() < deadline) {
		const result = await scan();
		if (result) return result;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	return null;
}

export function codexEntriesToTurns(entries: SessionEntry[]): ConversationTurn[] {
	const turns: ConversationTurn[] = [];
	for (const entry of entries) {
		if (entry.type !== 'response_item') continue;
		const payload = entry.payload as Record<string, unknown> | undefined;
		if (!payload || payload['type'] !== 'message') continue;
		const role = payload['role'];
		if (role !== 'user' && role !== 'assistant') continue;
		const contentParts = payload['content'];
		if (!Array.isArray(contentParts)) continue;
		const text = (contentParts as Array<{type: string; text?: string}>)
			.filter((p) => (p.type === 'input_text' || p.type === 'output_text') && p.text)
			.map((p) => p.text!)
			.join('')
			.trim();
		if (!text) continue;
		// Skip environment context injected by codex
		if (role === 'user' && text.startsWith('<environment_context>')) continue;
		turns.push({role: role as 'user' | 'assistant', content: text});
	}
	return turns;
}

export class CodexReader extends BaseCodingAgentReader {
	readonly agentName = 'codex-cli';

	/**
	 * Check whether a session exists.
	 * - During live session: stdout log has content (keyed by our internal UUID).
	 * - After re-keying to codex UUID, or for historical sessions: JSONL file exists in date dirs.
	 */
	sessionExists(_dir: string, sessionId: string): boolean {
		const logPath = getSessionLogPath(sessionId, 'stdout');
		try {
			if (existsSync(logPath) && statSync(logPath).size > 0) return true;
		} catch { /* ignore */ }
		return findSessionPath(sessionId) !== null;
	}

	/**
	 * Read session output.
	 * - stdout log exists (internal UUID before re-keying, or if codex hasn't been re-keyed yet): read from it.
	 * - Otherwise (codex UUID after re-keying, or historical): find JSONL file in date dirs.
	 */
	async readSessionOutput(
		_dir: string,
		sessionId: string,
		options: AgentReadOptions = {},
	): Promise<AgentReadResult> {
		// Check stdout log first (live/recent session tracked by our UUID)
		const logPath = getSessionLogPath(sessionId, 'stdout');
		const sessionPath = existsSync(logPath) && statSync(logPath).size > 0
			? logPath
			: findSessionPath(sessionId);

		if (!sessionPath) {
			return {entries: [], totalLines: 0, returnedLines: 0, fileExists: false, fileSizeBytes: 0, fileSizeHuman: '0 B'};
		}

		let fileSizeBytes = 0;
		try {
			fileSizeBytes = statSync(sessionPath).size;
		} catch { /* ignore */ }

		const fileSizeHuman = this.formatBytes(fileSizeBytes);
		try {
			const {entries, totalLines} = await this.readJsonlLines(sessionPath, options);
			return {entries, totalLines, returnedLines: entries.length, fileExists: true, fileSizeBytes, fileSizeHuman};
		} catch (err) {
			return {
				entries: [], totalLines: 0, returnedLines: 0, fileExists: true, fileSizeBytes, fileSizeHuman,
				error: err instanceof Error ? err.message : 'Failed to read session file',
			};
		}
	}

	async readSessionTurns(
		dir: string,
		sessionId: string,
		options: AgentReadOptions = {},
	): Promise<AgentTurnsResult> {
		const result = await this.readSessionOutput(dir, sessionId, options);
		return {
			turns: codexEntriesToTurns(result.entries),
			totalLines: result.totalLines,
			fileExists: result.fileExists,
			fileSizeBytes: result.fileSizeBytes,
			fileSizeHuman: result.fileSizeHuman,
			error: result.error,
		};
	}

	/**
	 * Extract title from codex JSONL format.
	 * Codex has no `summary` type — find the first user message that isn't the environment_context.
	 */
	protected async extractTitle(filePath: string): Promise<string | null> {
		return new Promise((resolve) => {
			let firstUserMessage: string | null = null;
			let resolved = false;

			const rl = createInterface({input: createReadStream(filePath), crlfDelay: Infinity});

			rl.on('line', (line) => {
				if (resolved || !line.trim()) return;
				try {
					const entry = JSON.parse(line) as SessionEntry & {payload?: Record<string, unknown>};
					if (
						entry.type === 'response_item' &&
						(entry.payload as any)?.type === 'message' &&
						(entry.payload as any)?.role === 'user'
					) {
						const content = (entry.payload as any)?.content;
						if (Array.isArray(content)) {
							for (const part of content) {
								if (part.type === 'input_text' && typeof part.text === 'string') {
									const text = part.text.trim();
									// Skip environment context injected by codex
									if (!text.startsWith('<environment_context>')) {
										firstUserMessage = text.slice(0, 120);
										resolved = true;
										rl.close();
										return;
									}
								}
							}
						}
					}
				} catch { /* skip */ }
			});

			rl.on('close', () => resolve(firstUserMessage));
			rl.on('error', () => resolve(null));
		});
	}

	async scanSessions(options: ScanOptions = {}): Promise<ScannedSession[]> {
		const results: ScannedSession[] = [];

		for (const {filePath, sessionId} of walkCodexSessions(options.since)) {
			let stats;
			try {
				stats = statSync(filePath);
			} catch {
				continue;
			}

			if (options.since && stats.mtimeMs < options.since) continue;

			results.push({
				sessionId,
				agent: this.agentName,
				dir: '', // populated below from session_meta
				title: null,
				filePath,
				fileSizeBytes: stats.size,
				createdAt: stats.birthtimeMs || stats.mtimeMs,
				updatedAt: stats.mtimeMs,
				turnCount: 0,
			});
		}

		results.sort((a, b) => b.updatedAt - a.updatedAt);

		// Populate title + dir from session_meta (first line) in parallel
		await Promise.all(results.map(async (s) => {
			const first = await readFirstLine(s.filePath);
			if (first?.type === 'session_meta') {
				const payload = first.payload as any;
				s.dir = payload?.cwd ?? '';
			}
			s.title = await this.extractTitle(s.filePath);
		}));

		// Apply dir filter after reading cwd from session_meta
		if (options.dir) {
			return results.filter((s) => s.dir === options.dir);
		}

		return results;
	}
}

export const codexReader = new CodexReader();
