import {existsSync, statSync, createReadStream} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createInterface} from 'node:readline';
import type {
	AgentReader,
	AgentReadResult,
	AgentReadOptions,
	SessionEntry,
} from './types';

// Claude Code projects directory
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// Max file size before limiting lines (5MB)
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
// Default lines to read when file is too large
const DEFAULT_LARGE_FILE_LINES = 100;

/**
 * Convert a directory path to Claude Code's folder name format
 * /Users/harshithmullapudi/Documents/core -> -Users-harshithmullapudi-Documents-core
 */
function dirToProjectFolder(dir: string): string {
	return dir.replace(/\//g, '-');
}

/**
 * Get the Claude Code session JSONL file path
 */
function getSessionPath(dir: string, sessionId: string): string {
	const projectFolder = dirToProjectFolder(dir);
	return join(CLAUDE_PROJECTS_DIR, projectFolder, `${sessionId}.jsonl`);
}

/**
 * Format bytes to human readable size
 */
function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Read JSONL file line by line (streaming)
 */
async function readJsonlLines(
	filePath: string,
	options: {lines?: number; offset?: number; tail?: boolean} = {},
): Promise<{entries: SessionEntry[]; totalLines: number}> {
	return new Promise((resolve, reject) => {
		const entries: SessionEntry[] = [];
		let lineCount = 0;

		const rl = createInterface({
			input: createReadStream(filePath),
			crlfDelay: Infinity,
		});

		rl.on('line', (line) => {
			if (!line.trim()) return;
			lineCount++;

			try {
				const entry = JSON.parse(line) as SessionEntry;
				entries.push(entry);
			} catch {
				// Skip malformed lines
			}
		});

		rl.on('close', () => {
			let resultEntries: SessionEntry[];
			const totalLines = entries.length;

			if (options.tail && options.lines) {
				const start = Math.max(0, totalLines - options.lines);
				resultEntries = entries.slice(start);
			} else if (options.lines || options.offset) {
				const offset = options.offset || 0;
				const limit = options.lines || totalLines;
				resultEntries = entries.slice(offset, offset + limit);
			} else {
				resultEntries = entries;
			}

			resolve({entries: resultEntries, totalLines});
		});

		rl.on('error', reject);
	});
}

/**
 * Claude Code session reader
 * Reads from ~/.claude/projects/<path>/<session-id>.jsonl
 */
export const claudeCodeReader: AgentReader = {
	sessionExists(dir: string, sessionId: string): boolean {
		const sessionPath = getSessionPath(dir, sessionId);
		return existsSync(sessionPath);
	},

	async readSessionOutput(
		dir: string,
		sessionId: string,
		options: AgentReadOptions = {},
	): Promise<AgentReadResult> {
		const sessionPath = getSessionPath(dir, sessionId);

		if (!existsSync(sessionPath)) {
			return {
				entries: [],
				totalLines: 0,
				returnedLines: 0,
				fileExists: false,
				fileSizeBytes: 0,
				fileSizeHuman: '0 B',
			};
		}

		// Get file size
		let fileSizeBytes = 0;
		try {
			const stats = statSync(sessionPath);
			fileSizeBytes = stats.size;
		} catch {
			// Ignore stat errors
		}

		const fileSizeHuman = formatBytes(fileSizeBytes);

		// If file is large and no explicit lines limit, auto-limit
		let readOptions = {...options};
		if (fileSizeBytes > MAX_FILE_SIZE_BYTES && !options.lines) {
			readOptions = {
				...options,
				lines: DEFAULT_LARGE_FILE_LINES,
				tail: true, // Get most recent entries
			};
		}

		try {
			const {entries, totalLines} = await readJsonlLines(
				sessionPath,
				readOptions,
			);

			return {
				entries,
				totalLines,
				returnedLines: entries.length,
				fileExists: true,
				fileSizeBytes,
				fileSizeHuman,
			};
		} catch (err) {
			return {
				entries: [],
				totalLines: 0,
				returnedLines: 0,
				fileExists: true,
				fileSizeBytes,
				fileSizeHuman,
				error: err instanceof Error ? err.message : 'Failed to read session file',
			};
		}
	},
};
