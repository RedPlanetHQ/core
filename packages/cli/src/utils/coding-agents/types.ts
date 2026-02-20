/**
 * Result from reading agent session output
 */
export interface AgentReadResult {
	output: string;
	totalLines: number;
	returnedLines: number;
	fileExists: boolean;
	error?: string;
}

/**
 * Options for reading session output
 */
export interface AgentReadOptions {
	lines?: number;
	offset?: number;
	tail?: boolean;
}

/**
 * Interface for agent-specific session readers
 */
export interface AgentReader {
	/**
	 * Read session output from the agent's storage format
	 */
	readSessionOutput(
		dir: string,
		sessionId: string,
		options?: AgentReadOptions,
	): AgentReadResult;

	/**
	 * Check if this agent's session file exists
	 */
	sessionExists(dir: string, sessionId: string): boolean;
}
