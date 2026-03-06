import type {AgentReader, AgentReadResult, AgentReadOptions} from './types';
import {claudeCodeReader} from './claude-code';

export type {AgentReader, AgentReadResult, AgentReadOptions};

/**
 * Registry of agent readers
 */
const agentReaders: Record<string, AgentReader> = {
	'claude-code': claudeCodeReader,
};

/**
 * Get the reader for a specific agent
 */
export function getAgentReader(agentName: string): AgentReader | null {
	return agentReaders[agentName] || null;
}

/**
 * Read session output using the appropriate agent reader
 */
export async function readAgentSessionOutput(
	agentName: string,
	dir: string,
	sessionId: string,
	options?: AgentReadOptions,
): Promise<AgentReadResult> {
	const reader = getAgentReader(agentName);

	if (!reader) {
		return {
			entries: [],
			totalLines: 0,
			returnedLines: 0,
			fileExists: false,
			fileSizeBytes: 0,
			fileSizeHuman: '0 B',
			error: `No reader available for agent: ${agentName}`,
		};
	}

	return reader.readSessionOutput(dir, sessionId, options);
}

/**
 * Check if a session exists for the given agent
 */
export function agentSessionExists(
	agentName: string,
	dir: string,
	sessionId: string,
): boolean {
	const reader = getAgentReader(agentName);
	if (!reader) {
		return false;
	}
	return reader.sessionExists(dir, sessionId);
}
