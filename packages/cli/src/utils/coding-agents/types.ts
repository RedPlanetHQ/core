export interface ContentBlock {
	type: string;
	text?: string;
	name?: string;
	input?: Record<string, unknown>;
}

export interface SessionEntry {
	type: string;
	message?: {
		role: string;
		content: string | ContentBlock[];
	};
	timestamp?: string;
	[key: string]: unknown;
}

export interface AgentReadResult {
	entries: SessionEntry[];
	totalLines: number;
	returnedLines: number;
	fileExists: boolean;
	fileSizeBytes: number;
	fileSizeHuman: string;
	error?: string;
}

export interface ConversationTurn {
	role: 'user' | 'assistant';
	content: string;
}

export interface AgentTurnsResult {
	turns: ConversationTurn[];
	totalLines: number;
	fileExists: boolean;
	fileSizeBytes: number;
	fileSizeHuman: string;
	error?: string;
}

export interface AgentReadOptions {
	lines?: number;
	offset?: number;
	tail?: boolean;
}

export interface ScannedSession {
	sessionId: string;
	agent: string;
	dir: string;
	title: string | null;
	filePath: string;
	fileSizeBytes: number;
	createdAt: number;
	updatedAt: number;
	turnCount: number;
}

export interface ScanOptions {
	agent?: string; // filter to a specific agent e.g. "claude-code" or "codex-cli"
	dir?: string;
	since?: number; // ms timestamp
	limit?: number;
	offset?: number;
}

export interface ScanResult {
	sessions: ScannedSession[];
	total: number;
	hasMore: boolean;
}

export abstract class BaseCodingAgentReader {
	abstract readonly agentName: string;

	abstract sessionExists(dir: string, sessionId: string): boolean;

	/**
	 * Returns true if the session transcript has been written to since `since` (ms since epoch).
	 * Used to detect readiness on resume, where the file pre-exists and `sessionExists` is
	 * satisfied immediately — we need evidence of new activity by the resumed process.
	 */
	abstract sessionUpdatedSince(dir: string, sessionId: string, since: number): boolean;

	abstract readSessionOutput(
		dir: string,
		sessionId: string,
		options?: AgentReadOptions,
	): Promise<AgentReadResult>;

	abstract readSessionTurns(
		dir: string,
		sessionId: string,
		options?: AgentReadOptions,
	): Promise<AgentTurnsResult>;

	abstract scanSessions(options?: ScanOptions): Promise<ScannedSession[]>;

	// ── Shared utilities ──────────────────────────────────────────────────────

	protected formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
	}

	protected async readJsonlLines(
		filePath: string,
		options: {lines?: number; offset?: number; tail?: boolean} = {},
	): Promise<{entries: SessionEntry[]; totalLines: number}> {
		const {createReadStream} = await import('node:fs');
		const {createInterface} = await import('node:readline');

		return new Promise((resolve, reject) => {
			const entries: SessionEntry[] = [];

			const rl = createInterface({
				input: createReadStream(filePath),
				crlfDelay: Infinity,
			});

			rl.on('line', (line) => {
				if (!line.trim()) return;
				try {
					entries.push(JSON.parse(line) as SessionEntry);
				} catch {
					// Skip malformed
				}
			});

			rl.on('close', () => {
				const totalLines = entries.length;
				let result: SessionEntry[];

				if (options.tail && options.lines) {
					result = entries.slice(Math.max(0, totalLines - options.lines));
				} else if (options.lines || options.offset) {
					const offset = options.offset || 0;
					const limit = options.lines || totalLines;
					result = entries.slice(offset, offset + limit);
				} else {
					result = entries;
				}

				resolve({entries: result, totalLines});
			});

			rl.on('error', reject);
		});
	}

	protected async extractTitle(filePath: string): Promise<string | null> {
		const {createReadStream} = await import('node:fs');
		const {createInterface} = await import('node:readline');

		return new Promise((resolve) => {
			let title: string | null = null;
			let firstUserMessage: string | null = null;
			let resolved = false;

			const rl = createInterface({
				input: createReadStream(filePath),
				crlfDelay: Infinity,
			});

			rl.on('line', (line) => {
				if (resolved || !line.trim()) return;
				try {
					const entry = JSON.parse(line) as SessionEntry & {summary?: string};

					if (entry.type === 'summary' && entry.summary) {
						title = entry.summary as string;
						resolved = true;
						rl.close();
						return;
					}

					if (!firstUserMessage && entry.message?.role === 'user') {
						const content = entry.message.content;
						let raw = '';
						if (typeof content === 'string') {
							raw = content;
						} else if (Array.isArray(content)) {
							const part = content.find((p) => p.type === 'text' && p.text);
							raw = part?.text ?? '';
						}
						// Strip system-injected XML tags e.g. <local-command-caveat>...</local-command-caveat>
						const clean = raw
							.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '')
							.replace(/<[^>]+>/g, '')
							.trim();
						if (clean) firstUserMessage = clean.slice(0, 120);
					}
				} catch {
					// Skip malformed
				}
			});

			rl.on('close', () => resolve(title ?? firstUserMessage ?? null));
			rl.on('error', () => resolve(null));
		});
	}
}
