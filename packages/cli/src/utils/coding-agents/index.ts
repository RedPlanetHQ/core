import {BaseCodingAgentReader, type AgentReadResult, type AgentReadOptions, type AgentTurnsResult, type ConversationTurn, type ScannedSession, type ScanOptions, type ScanResult} from './types';
import {claudeCodeReader, claudeCodeEntriesToTurns} from './claude-code';
import {codexReader, codexEntriesToTurns, findLatestCodexSession} from './codex';

export {findLatestCodexSession};
export {claudeCodeEntriesToTurns, codexEntriesToTurns};

export type {AgentReadResult, AgentReadOptions, AgentTurnsResult, ConversationTurn, ScannedSession, ScanOptions, ScanResult};
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

export async function readAgentSessionTurns(
	agentName: string,
	dir: string,
	sessionId: string,
	options?: AgentReadOptions,
): Promise<AgentTurnsResult> {
	const reader = getAgentReader(agentName);
	if (!reader) {
		return {
			turns: [], totalLines: 0, fileExists: false, fileSizeBytes: 0,
			fileSizeHuman: '0 B', error: `No reader for agent: ${agentName}`,
		};
	}
	return reader.readSessionTurns(dir, sessionId, options);
}

export function agentSessionExists(agentName: string, dir: string, sessionId: string): boolean {
	return getAgentReader(agentName)?.sessionExists(dir, sessionId) ?? false;
}

export function agentSessionUpdatedSince(
	agentName: string,
	dir: string,
	sessionId: string,
	since: number,
): boolean {
	return getAgentReader(agentName)?.sessionUpdatedSince(dir, sessionId, since) ?? false;
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
	const sessions = options.limit !== undefined
		? merged.slice(offset, offset + options.limit)
		: merged.slice(offset);

	return {sessions, total, hasMore: options.limit !== undefined && offset + options.limit < total};
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
