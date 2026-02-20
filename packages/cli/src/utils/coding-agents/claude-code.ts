import {
	existsSync,
	readFileSync,
	statSync,
	openSync,
	readSync,
	closeSync,
} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import type {AgentReader, AgentReadResult, AgentReadOptions} from './types';

// Claude Code projects directory
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

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
 * Read the last N bytes from a file (for efficient tail)
 */
function readLastBytes(filePath: string, maxBytes: number): string {
	const stats = statSync(filePath);
	const fileSize = stats.size;
	const bytesToRead = Math.min(maxBytes, fileSize);
	const startPosition = fileSize - bytesToRead;

	const fd = openSync(filePath, 'r');
	const buffer = Buffer.alloc(bytesToRead);
	readSync(fd, buffer, 0, bytesToRead, startPosition);
	closeSync(fd);

	return buffer.toString('utf-8');
}

interface ClaudeSessionMessage {
	type: string;
	message?: {
		role: string;
		content: string | Array<{type: string; text?: string}>;
	};
	timestamp?: string;
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

	readSessionOutput(
		dir: string,
		sessionId: string,
		options: AgentReadOptions = {},
	): AgentReadResult {
		const sessionPath = getSessionPath(dir, sessionId);

		if (!existsSync(sessionPath)) {
			return {
				output: '',
				totalLines: 0,
				returnedLines: 0,
				fileExists: false,
			};
		}

		let content: string;

		try {
			// For tail mode with limited lines, only read last portion of file
			if (options.tail && options.lines && options.lines < 100) {
				// Read last ~500KB which should be enough for recent output
				content = readLastBytes(sessionPath, 500 * 1024);
				// Find first complete line (skip partial line at start)
				const firstNewline = content.indexOf('\n');
				if (firstNewline > 0) {
					content = content.slice(firstNewline + 1);
				}
			} else {
				content = readFileSync(sessionPath, 'utf-8');
			}
		} catch (err) {
			return {
				output: '',
				totalLines: 0,
				returnedLines: 0,
				fileExists: true,
				error: err instanceof Error ? err.message : 'Failed to read session file',
			};
		}

		const lines = content.trim().split('\n');
		const outputLines: string[] = [];

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line) as ClaudeSessionMessage;

				// Extract assistant messages
				if (entry.type === 'assistant' && entry.message?.content) {
					const msgContent = entry.message.content;
					if (typeof msgContent === 'string') {
						outputLines.push(msgContent);
					} else if (Array.isArray(msgContent)) {
						for (const block of msgContent) {
							if (block.type === 'text' && block.text) {
								outputLines.push(block.text);
							}
						}
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		const totalLines = outputLines.length;
		let resultLines: string[];

		if (options.tail && options.lines) {
			const start = Math.max(0, totalLines - options.lines);
			resultLines = outputLines.slice(start);
		} else if (options.lines || options.offset) {
			const offset = options.offset || 0;
			const limit = options.lines || totalLines;
			resultLines = outputLines.slice(offset, offset + limit);
		} else {
			resultLines = outputLines;
		}

		return {
			output: resultLines.join('\n'),
			totalLines,
			returnedLines: resultLines.length,
			fileExists: true,
		};
	},
};
