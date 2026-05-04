import {existsSync, statSync, readdirSync, createReadStream} from 'node:fs';
import {join, basename} from 'node:path';
import {homedir} from 'node:os';
import {createInterface} from 'node:readline';
import {BaseCodingAgentReader, type AgentReadResult, type AgentReadOptions, type AgentTurnsResult, type ConversationTurn, type ScannedSession, type ScanOptions, type SessionEntry, type ContentBlock} from './types';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/**
 * /Users/foo/bar       →  -Users-foo-bar
 * /Users/foo/.work/bar →  -Users-foo--work-bar
 *
 * Claude Code encodes both `/` and `.` as `-` when mapping cwd → project folder,
 * so paths containing dot-prefixed segments (e.g. `.worktrees`) collapse to a
 * double hyphen. Match that exactly or session lookups miss the file.
 */
function dirToProjectFolder(dir: string): string {
	return dir.replace(/[/.]/g, '-');
}

/**
 * -Users-foo-bar  →  /Users/foo/bar
 *
 * WARNING: lossy — hyphens in original path components become `/`.
 * `/Users/foo/feature-linear-widget` and `/Users/foo/feature/linear/widget`
 * both encode to the same folder. Use only as fallback; prefer `readCwdFromJsonl`.
 */
function projectFolderToDir(folder: string): string {
	return folder.replace(/^-/, '/').replace(/-/g, '/');
}

/**
 * Scan the first entries of a Claude Code JSONL until we hit one with a `cwd` field.
 * user/assistant/progress entries carry `cwd`; the initial `file-history-snapshot` does not.
 */
async function readCwdFromJsonl(filePath: string): Promise<string | null> {
	return new Promise((resolve) => {
		let found: string | null = null;
		let lines = 0;
		const rl = createInterface({input: createReadStream(filePath), crlfDelay: Infinity});
		rl.on('line', (line) => {
			if (found || !line.trim()) return;
			if (++lines > 50) { rl.close(); return; }
			try {
				const entry = JSON.parse(line) as {cwd?: unknown};
				if (typeof entry.cwd === 'string' && entry.cwd) {
					found = entry.cwd;
					rl.close();
				}
			} catch { /* skip malformed */ }
		});
		rl.on('close', () => resolve(found));
		rl.on('error', () => resolve(null));
	});
}

function getSessionPath(dir: string, sessionId: string): string {
	return join(CLAUDE_PROJECTS_DIR, dirToProjectFolder(dir), `${sessionId}.jsonl`);
}

const TOOL_PRIMARY_KEYS = ['command', 'file_path', 'query', 'prompt', 'description', 'title', 'pattern'];

function formatToolUse(block: ContentBlock): string {
	const name = block.name ?? 'unknown';
	const input = block.input ?? {};
	for (const key of TOOL_PRIMARY_KEYS) {
		const val = input[key];
		if (typeof val === 'string' && val) {
			const truncated = val.length > 100 ? val.slice(0, 97) + '...' : val;
			return `[${name}] ${truncated}`;
		}
	}
	return `[${name}]`;
}

export function claudeCodeEntriesToTurns(entries: SessionEntry[]): ConversationTurn[] {
	const turns: ConversationTurn[] = [];
	for (const entry of entries) {
		if ((entry.type !== 'user' && entry.type !== 'assistant') || !entry.message) continue;
		const {role, content} = entry.message;
		if (role !== 'user' && role !== 'assistant') continue;

		const parts: string[] = [];

		if (typeof content === 'string') {
			const t = content.trim();
			if (t) parts.push(t);
		} else if (Array.isArray(content)) {
			const textPart = content
				.filter((p) => p.type === 'text' && p.text)
				.map((p) => p.text!)
				.join('')
				.trim();
			if (textPart) parts.push(textPart);

			if (role === 'assistant') {
				const toolLines = content
					.filter((p) => p.type === 'tool_use')
					.map((p) => formatToolUse(p));
				if (toolLines.length > 0) parts.push(toolLines.join('\n'));
			}
		}

		const combined = parts.join('\n');
		if (combined) turns.push({role: role as 'user' | 'assistant', content: combined});
	}
	return turns;
}

export class ClaudeCodeReader extends BaseCodingAgentReader {
	readonly agentName = 'claude-code';

	sessionExists(dir: string, sessionId: string): boolean {
		return existsSync(getSessionPath(dir, sessionId));
	}

	sessionUpdatedSince(dir: string, sessionId: string, since: number): boolean {
		const sessionPath = getSessionPath(dir, sessionId);
		try {
			return statSync(sessionPath).mtimeMs > since;
		} catch {
			return false;
		}
	}

	async readSessionOutput(
		dir: string,
		sessionId: string,
		options: AgentReadOptions = {},
	): Promise<AgentReadResult> {
		const sessionPath = getSessionPath(dir, sessionId);

		if (!existsSync(sessionPath)) {
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
			turns: claudeCodeEntriesToTurns(result.entries),
			totalLines: result.totalLines,
			fileExists: result.fileExists,
			fileSizeBytes: result.fileSizeBytes,
			fileSizeHuman: result.fileSizeHuman,
			error: result.error,
		};
	}

	async scanSessions(options: ScanOptions = {}): Promise<ScannedSession[]> {
		if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];

		let projectFolders: string[];
		try {
			projectFolders = readdirSync(CLAUDE_PROJECTS_DIR);
		} catch {
			return [];
		}

		// Prefilter by encoded folder name when options.dir is set. Folder-match is a
		// necessary-but-not-sufficient condition (hyphens collide), so we still verify
		// against the real cwd below — this just prunes obviously-unrelated folders.
		const expectedFolder = options.dir ? dirToProjectFolder(options.dir) : null;

		const results: ScannedSession[] = [];

		for (const folder of projectFolders) {
			if (expectedFolder && folder !== expectedFolder) continue;

			const fallbackDir = projectFolderToDir(folder);
			const projectPath = join(CLAUDE_PROJECTS_DIR, folder);
			let files: string[];
			try {
				files = readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));
			} catch {
				continue;
			}

			for (const file of files) {
				const filePath = join(projectPath, file);
				let stats;
				try {
					stats = statSync(filePath);
				} catch {
					continue;
				}

				if (options.since && stats.mtimeMs < options.since) continue;

				results.push({
					sessionId: basename(file, '.jsonl'),
					agent: this.agentName,
					dir: fallbackDir, // overwritten below from JSONL cwd when available
					title: null,
					filePath,
					fileSizeBytes: stats.size,
					createdAt: stats.birthtimeMs || stats.mtimeMs,
					updatedAt: stats.mtimeMs,
					turnCount: 0,
				});
			}
		}

		results.sort((a, b) => b.updatedAt - a.updatedAt);

		// Populate real cwd + title in parallel. The decoded folder name is lossy
		// (any `-` in the original path collides with `/`), so the real cwd must come
		// from the JSONL entries themselves.
		await Promise.all(results.map(async (s) => {
			const [cwd, title] = await Promise.all([
				readCwdFromJsonl(s.filePath),
				this.extractTitle(s.filePath),
			]);
			if (cwd) s.dir = cwd;
			s.title = title;
		}));

		// Final filter against the real cwd (after the cheap folder-level prefilter above).
		return options.dir ? results.filter((s) => s.dir === options.dir) : results;
	}
}

export const claudeCodeReader = new ClaudeCodeReader();
