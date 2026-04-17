import {existsSync, statSync, readdirSync} from 'node:fs';
import {join, basename} from 'node:path';
import {homedir} from 'node:os';
import {BaseCodingAgentReader, type AgentReadResult, type AgentReadOptions, type AgentTurnsResult, type ConversationTurn, type ScannedSession, type ScanOptions, type SessionEntry} from './types';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_LARGE_FILE_LINES = 100;

/**
 * /Users/foo/bar  →  -Users-foo-bar
 */
function dirToProjectFolder(dir: string): string {
	return dir.replace(/\//g, '-');
}

/**
 * -Users-foo-bar  →  /Users/foo/bar
 */
function projectFolderToDir(folder: string): string {
	return folder.replace(/^-/, '/').replace(/-/g, '/');
}

function getSessionPath(dir: string, sessionId: string): string {
	return join(CLAUDE_PROJECTS_DIR, dirToProjectFolder(dir), `${sessionId}.jsonl`);
}

function extractText(content: string | Array<{type: string; text?: string}>): string {
	if (typeof content === 'string') return content;
	// Only grab 'text' parts — skip 'thinking', 'tool_use', 'tool_result', etc.
	return content
		.filter((p) => p.type === 'text' && p.text)
		.map((p) => p.text!)
		.join('');
}

export function claudeCodeEntriesToTurns(entries: SessionEntry[]): ConversationTurn[] {
	const turns: ConversationTurn[] = [];
	for (const entry of entries) {
		if ((entry.type !== 'user' && entry.type !== 'assistant') || !entry.message) continue;
		const {role, content} = entry.message;
		if (role !== 'user' && role !== 'assistant') continue;
		const text = extractText(content).trim();
		if (text) turns.push({role: role as 'user' | 'assistant', content: text});
	}
	return turns;
}

export class ClaudeCodeReader extends BaseCodingAgentReader {
	readonly agentName = 'claude-code';

	sessionExists(dir: string, sessionId: string): boolean {
		return existsSync(getSessionPath(dir, sessionId));
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

		let readOptions = {...options};
		if (fileSizeBytes > MAX_FILE_SIZE_BYTES && !options.lines) {
			readOptions = {...options, lines: DEFAULT_LARGE_FILE_LINES, tail: true};
		}

		try {
			const {entries, totalLines} = await this.readJsonlLines(sessionPath, readOptions);
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

		const results: ScannedSession[] = [];

		for (const folder of projectFolders) {
			const dir = projectFolderToDir(folder);
			if (options.dir && dir !== options.dir) continue;

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
					dir,
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

		// Populate titles in parallel (before slicing — titles are cheap to read)
		await Promise.all(results.map(async (s) => {
			s.title = await this.extractTitle(s.filePath);
		}));

		return results;
	}
}

export const claudeCodeReader = new ClaudeCodeReader();
