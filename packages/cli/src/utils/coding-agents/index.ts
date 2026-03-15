import {BaseCodingAgentReader, type AgentReadResult, type AgentReadOptions, type ScannedSession, type ScanOptions, type ScanResult} from './types';
import {claudeCodeReader} from './claude-code';
import {codexReader, findLatestCodexSession} from './codex';

export {findLatestCodexSession};

export type {AgentReadResult, AgentReadOptions, ScannedSession, ScanOptions, ScanResult};
export {BaseCodingAgentReader};

const agentReaders: Record<string, BaseCodingAgentReader> = {
	'claude-code': claudeCodeReader,
	'codex-cli': codexReader,
};

export function getAgentReader(agentName: string): BaseCodingAgentReader | null {
	return agentReaders[agentName] || null;
}

export async function readAgentSessionOutput(
	agentName: string,
	dir: string,
	sessionId: string,
	options?: AgentReadOptions,
): Promise<AgentReadResult> {
	const reader = getAgentReader(agentName);
	if (!reader) {
		return {
			entries: [], totalLines: 0, returnedLines: 0, fileExists: false, fileSizeBytes: 0,
			fileSizeHuman: '0 B', error: `No reader for agent: ${agentName}`,
		};
	}
	return reader.readSessionOutput(dir, sessionId, options);
}

export function resolveSessionFilePath(agentName: string, dir: string, sessionId: string): string | null {
	return getAgentReader(agentName)?.findSessionFilePath(dir, sessionId) ?? null;
}

export function agentSessionExists(agentName: string, dir: string, sessionId: string): boolean {
	return getAgentReader(agentName)?.sessionExists(dir, sessionId) ?? false;
}

/**
 * Scan sessions across all registered agents, merge, sort by recency, and paginate.
 */
export async function scanAllSessions(options: ScanOptions = {}): Promise<ScanResult> {
	const readers = options.agent
		? Object.values(agentReaders).filter((r) => r.agentName === options.agent)
		: Object.values(agentReaders);

	const allResults = await Promise.all(readers.map((r) => r.scanSessions(options)));

	const merged = allResults.flat().sort((a, b) => b.updatedAt - a.updatedAt);
	const total = merged.length;

	const offset = options.offset ?? 0;
	const limit = options.limit ?? 20;
	const sessions = merged.slice(offset, offset + limit);

	return {sessions, total, hasMore: offset + limit < total};
}

/**
 * Search sessions by title across all agents.
 */
export async function searchSessions(
	query: string,
	options: Omit<ScanOptions, 'offset'> & {limit?: number} = {},
): Promise<ScannedSession[]> {
	const {sessions: all} = await scanAllSessions({...options, limit: undefined});
	const q = query.toLowerCase();
	const matched = all.filter((s) => s.title?.toLowerCase().includes(q));
	return options.limit ? matched.slice(0, options.limit) : matched;
}
