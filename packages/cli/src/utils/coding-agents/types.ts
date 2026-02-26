/**
 * A single JSONL entry from a session
 */
export interface SessionEntry {
	type: string;
	message?: {
		role: string;
		content: string | Array<{type: string; text?: string}>;
	};
	timestamp?: string;
	[key: string]: unknown;
}

/**
 * Result from reading agent session output
 */
export interface AgentReadResult {
	entries: SessionEntry[];
	totalLines: number;
	returnedLines: number;
	fileExists: boolean;
	fileSizeBytes: number;
	fileSizeHuman: string;
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
	): Promise<AgentReadResult>;

	/**
	 * Check if this agent's session file exists
	 */
	sessionExists(dir: string, sessionId: string): boolean;
}
