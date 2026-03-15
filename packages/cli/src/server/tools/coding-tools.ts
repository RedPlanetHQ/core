import zod from 'zod';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import type {GatewayTool} from './browser-tools';
import {getPreferences} from '@/config/preferences';
import {
	getSession,
	upsertSession,
	deleteSession,
	listRunningSessions,
	isProcessRunningByPid,
} from '@/utils/coding-sessions';
import {
	getAgentConfig,
	buildStartArgs,
	buildResumeArgs,
	startAgentProcess,
	isProcessRunning,
	stopProcess,
	startIdleWatchdog,
	type Logger,
} from '@/utils/coding-runner';
import {
	readAgentSessionOutput,
	agentSessionExists,
	getAgentReader,
	scanAllSessions,
	searchSessions,
	findLatestCodexSession,
} from '@/utils/coding-agents';

// ============ Schemas ============

const AskSchema = zod.object({
	agent: zod.string().optional(),
	prompt: zod.string(),
	dir: zod.string(),
	sessionId: zod.string().optional(),
	model: zod.string().optional(),
	systemPrompt: zod.string().optional(),
});

const CloseSessionSchema = zod.object({
	sessionId: zod.string(),
});

const ReadSessionSchema = zod.object({
	sessionId: zod.string(),
	dir: zod.string(),
	lines: zod.number().optional(),
	offset: zod.number().optional(),
	tail: zod.boolean().optional(),
});

const ListSessionsSchema = zod.object({
	agent: zod.string().optional(), // e.g. "claude-code" or "codex-cli"
	since: zod.string().optional(), // ISO date string e.g. "2024-01-01"
	dir: zod.string().optional(),
	limit: zod.number().optional(),
	offset: zod.number().optional(),
});

const SearchSessionsSchema = zod.object({
	query: zod.string(),
	dir: zod.string().optional(),
	limit: zod.number().optional(),
});

// ============ JSON Schemas ============

const jsonSchemas: Record<string, Record<string, unknown>> = {
	coding_ask: {
		type: 'object',
		properties: {
			agent: {
				type: 'string',
				description:
					'Coding agent to use (e.g., "claude-code", "codex-cli"). Omit to use the configured default.',
			},
			prompt: {
				type: 'string',
				description: 'The question or task to send to the agent',
			},
			dir: {
				type: 'string',
				description: 'Working directory for the session (must exist)',
			},
			sessionId: {
				type: 'string',
				description:
					'Existing session ID to continue. Omit to start a new session.',
			},
			model: {
				type: 'string',
				description: 'Model override (optional)',
			},
			systemPrompt: {
				type: 'string',
				description: 'System prompt override (optional, new sessions only)',
			},
		},
		required: ['agent', 'prompt', 'dir'],
	},
	coding_close_session: {
		type: 'object',
		properties: {
			sessionId: {type: 'string', description: 'Session ID to close'},
		},
		required: ['sessionId'],
	},
	coding_read_session: {
		type: 'object',
		properties: {
			sessionId: {
				type: 'string',
				description: 'Session ID to read output from',
			},
			dir: {type: 'string', description: 'Working directory of the session'},
			lines: {type: 'number', description: 'Number of lines to return'},
			offset: {
				type: 'number',
				description: 'Line offset to start from (0-indexed)',
			},
			tail: {
				type: 'boolean',
				description: 'If true, return the last N lines instead of first N',
			},
		},
		required: ['sessionId', 'dir'],
	},
	coding_list_sessions: {
		type: 'object',
		properties: {
			agent: {
				type: 'string',
				description:
					'Filter to a specific agent (e.g. "claude-code", "codex-cli")',
			},
			since: {
				type: 'string',
				description:
					'ISO date string to filter sessions updated after this date (e.g. "2024-03-01")',
			},
			dir: {
				type: 'string',
				description: 'Filter to a specific working directory (optional)',
			},
			limit: {
				type: 'number',
				description: 'Max sessions to return per page (default: 20)',
			},
			offset: {
				type: 'number',
				description: 'Sessions to skip for pagination (default: 0)',
			},
		},
		required: [],
	},
	coding_search_sessions: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Search term to match against session titles',
			},
			dir: {
				type: 'string',
				description:
					'Restrict search to a specific working directory (optional)',
			},
			limit: {
				type: 'number',
				description: 'Max results to return (default: 10)',
			},
		},
		required: ['query'],
	},
	coding_list_agents: {
		type: 'object',
		properties: {},
		required: [],
	},
};

// ============ Tool Definitions ============

export const codingTools: GatewayTool[] = [
	{
		name: 'coding_ask',
		description:
			'Send a prompt to a coding agent. Omit sessionId to start a new session; include it to continue an existing one. After calling, use coding_read_session to check output.',
		inputSchema: jsonSchemas.coding_ask!,
	},
	{
		name: 'coding_close_session',
		description: 'Stop a running coding session',
		inputSchema: jsonSchemas.coding_close_session!,
	},
	{
		name: 'coding_read_session',
		description:
			'Read current output from a coding session (works while running)',
		inputSchema: jsonSchemas.coding_read_session!,
	},
	{
		name: 'coding_list_sessions',
		description:
			"List all coding sessions from Claude's session history. Sorted by most recent. Supports date filtering.",
		inputSchema: jsonSchemas.coding_list_sessions!,
	},
	{
		name: 'coding_search_sessions',
		description:
			'Search past coding sessions by title or first message content',
		inputSchema: jsonSchemas.coding_search_sessions!,
	},
	{
		name: 'coding_list_agents',
		description:
			'List all configured coding agents and which one is the default',
		inputSchema: jsonSchemas.coding_list_agents!,
	},
];

// ============ Helpers ============

/**
 * Resolve which agent to use.
 * Priority: explicit param → defaultCodingAgent pref → only configured agent → error
 */
function resolveAgent(agentParam?: string): {agent: string} | {error: string} {
	if (agentParam) return {agent: agentParam};

	const prefs = getPreferences();
	const coding = (prefs.coding ?? {}) as Record<string, unknown>;
	const configured = Object.keys(coding);

	if (configured.length === 0) {
		return {error: 'No coding agents configured. Run: corebrain coding setup'};
	}

	if (prefs.defaultCodingAgent && coding[prefs.defaultCodingAgent]) {
		return {agent: prefs.defaultCodingAgent};
	}

	if (configured.length === 1) {
		return {agent: configured[0]!};
	}

	return {
		error: `Multiple agents configured (${configured.join(
			', ',
		)}). Specify which to use or set a default with: corebrain coding setup`,
	};
}

/**
 * Auto-detect the agent for a session ID by trying all registered readers.
 * Falls back to default agent or claude-code.
 */
function detectAgentForSession(sessionId: string, dir: string): string {
	// Check running session store first
	const stored = getSession(sessionId);
	if (stored?.agent) return stored.agent;

	// Try each reader's sessionExists
	const readers = ['claude-code', 'codex-cli'] as const;
	for (const agentName of readers) {
		const reader = getAgentReader(agentName);
		if (reader?.sessionExists(dir, sessionId)) return agentName;
	}

	// Fall back to default
	const prefs = getPreferences();
	return prefs.defaultCodingAgent ?? 'claude-code';
}

// ============ Handlers ============

async function handleAsk(params: zod.infer<typeof AskSchema>, logger?: Logger) {
	if (!existsSync(params.dir)) {
		return {success: false, error: `Directory "${params.dir}" does not exist`};
	}

	const resolved = resolveAgent(params.agent);
	if ('error' in resolved) return {success: false, error: resolved.error};
	const agentName = resolved.agent;

	const config = getAgentConfig(agentName);
	if (!config) {
		return {
			success: false,
			error: `Agent "${agentName}" not configured. Run 'corebrain coding config --agent ${agentName}' to set up.`,
		};
	}

	const isResume = Boolean(params.sessionId);
	let sessionId = params.sessionId || randomUUID();

	// For resume, verify process is not already running
	if (isResume && isProcessRunning(sessionId)) {
		return {
			success: false,
			error: `Session "${sessionId}" is already running. Wait for it to finish before sending another prompt.`,
		};
	}

	// Build args
	const args = isResume
		? buildResumeArgs(config, {prompt: params.prompt, sessionId})
		: buildStartArgs(config, {
				prompt: params.prompt,
				sessionId,
				model: params.model,
				systemPrompt: params.systemPrompt,
		  });

	const startedAt = Date.now();

	// Upsert running session record
	upsertSession({sessionId, agent: agentName, dir: params.dir, startedAt});

	const {pid, error} = startAgentProcess(
		sessionId,
		config,
		args,
		params.dir,
		logger,
	);

	if (error) {
		deleteSession(sessionId);
		return {success: false, error: `Failed to start: ${error}`};
	}

	// Store pid
	upsertSession({sessionId, agent: agentName, dir: params.dir, pid, startedAt});

	// Start idle watchdog — kills the process if stdout goes silent for 30s
	if (pid) startIdleWatchdog(sessionId, pid);

	// For agents with a session reader, wait until the session file appears
	const hasReader = getAgentReader(agentName) !== null;
	if (hasReader && !isResume) {
		const deadline = Date.now() + 30_000;
		const sessionReady = await new Promise<boolean>(resolve => {
			function check() {
				if (agentSessionExists(agentName, params.dir, sessionId))
					return resolve(true);
				if (!isProcessRunning(sessionId))
					return resolve(agentSessionExists(agentName, params.dir, sessionId));
				if (Date.now() >= deadline)
					return resolve(agentSessionExists(agentName, params.dir, sessionId));
				setTimeout(check, 500);
			}
			setTimeout(check, 500);
		});

		if (!sessionReady) {
			stopProcess(sessionId);
			deleteSession(sessionId);
			return {
				success: false,
				error:
					'Session failed to start: agent did not produce output within 30 seconds',
			};
		}

		// For codex-cli: find the actual session ID codex assigned (its own UUID in the filename)
		// and re-key our running session record to use it.
		if (agentName === 'codex-cli') {
			const found = await findLatestCodexSession(params.dir, startedAt);

			if (found && found.sessionId !== sessionId) {
				sessionId = found.sessionId;
				upsertSession({
					sessionId: found.sessionId,
					agent: agentName,
					dir: params.dir,
					pid,
					startedAt,
				});
				return {
					success: true,
					result: {
						sessionId: found.sessionId,
						pid,
						resumed: isResume,
						message: 'Session started. Come back in ~1 minute, then use coding_read_session to check output.',
					},
				};
			}
		}
	}

	return {
		success: true,
		result: {
			sessionId,
			pid,
			resumed: isResume,
			message: 'Session started. Come back in ~1 minute, then use coding_read_session to check output.',
		},
	};
}

function handleCloseSession(params: zod.infer<typeof CloseSessionSchema>) {
	stopProcess(params.sessionId);
	deleteSession(params.sessionId);
	return {
		success: true,
		result: {sessionId: params.sessionId, message: 'Session closed'},
	};
}

async function handleReadSession(params: zod.infer<typeof ReadSessionSchema>) {
	const running = isProcessRunning(params.sessionId);

	// Detect agent: running store → reader probe → default
	const agent = detectAgentForSession(params.sessionId, params.dir);

	const {
		entries,
		totalLines,
		returnedLines,
		fileExists,
		fileSizeBytes,
		fileSizeHuman,
		error: readError,
	} = await readAgentSessionOutput(agent, params.dir, params.sessionId, {
		lines: params.lines,
		offset: params.offset,
		tail: params.tail,
	});

	let status: string;
	let statusMessage: string | undefined;

	if (running && !fileExists) {
		status = 'initializing';
		statusMessage = 'Agent is booting. Wait a few seconds and read again.';
	} else if (running) {
		status = 'running';
	} else {
		// Process finished — clean up running session record
		const stored = getSession(params.sessionId);
		if (stored) deleteSession(params.sessionId);
		status = 'completed';
	}

	return {
		success: true,
		result: {
			sessionId: params.sessionId,
			dir: params.dir,
			status,
			...(statusMessage ? {statusMessage} : {}),
			running,
			entries,
			error: readError,
			totalLines,
			returnedLines,
			fileExists,
			fileSizeBytes,
			fileSizeHuman,
		},
	};
}

async function handleListSessions(
	params: zod.infer<typeof ListSessionsSchema>,
) {
	const since = params.since ? new Date(params.since).getTime() : undefined;
	const {sessions, total, hasMore} = await scanAllSessions({
		agent: params.agent,
		dir: params.dir,
		since,
		limit: params.limit ?? 20,
		offset: params.offset ?? 0,
	});

	const runningIds = new Set(listRunningSessions().map(s => s.sessionId));

	return {
		success: true,
		result: {
			sessions: sessions.map(s => ({
				sessionId: s.sessionId,
				agent: s.agent,
				dir: s.dir,
				title: s.title,
				running: runningIds.has(s.sessionId),
				createdAt: new Date(s.createdAt).toISOString(),
				updatedAt: new Date(s.updatedAt).toISOString(),
				fileSizeBytes: s.fileSizeBytes,
			})),
			total,
			hasMore,
			offset: params.offset ?? 0,
		},
	};
}

async function handleSearchSessions(
	params: zod.infer<typeof SearchSessionsSchema>,
) {
	const sessions = await searchSessions(params.query, {
		dir: params.dir,
		limit: params.limit ?? 10,
	});

	const runningIds = new Set(listRunningSessions().map(s => s.sessionId));

	return {
		success: true,
		result: {
			sessions: sessions.map(s => ({
				sessionId: s.sessionId,
				dir: s.dir,
				title: s.title,
				running: runningIds.has(s.sessionId),
				updatedAt: new Date(s.updatedAt).toISOString(),
			})),
			count: sessions.length,
		},
	};
}

function handleListAgents() {
	const prefs = getPreferences();
	const coding = (prefs.coding ?? {}) as Record<string, unknown>;
	const agents = Object.keys(coding).map(name => ({
		name,
		isDefault: name === (prefs.defaultCodingAgent ?? Object.keys(coding)[0]),
	}));
	return {
		success: true,
		result: {
			agents,
			default: prefs.defaultCodingAgent ?? agents[0]?.name ?? null,
		},
	};
}

// ============ Dispatch ============

export async function executeCodingTool(
	toolName: string,
	params: Record<string, unknown>,
	logger?: Logger,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	try {
		switch (toolName) {
			case 'coding_ask':
				return await handleAsk(AskSchema.parse(params), logger);
			case 'coding_close_session':
				return handleCloseSession(CloseSessionSchema.parse(params));
			case 'coding_read_session':
				return await handleReadSession(ReadSessionSchema.parse(params));
			case 'coding_list_sessions':
				return await handleListSessions(ListSessionsSchema.parse(params));
			case 'coding_search_sessions':
				return await handleSearchSessions(SearchSessionsSchema.parse(params));
			case 'coding_list_agents':
				return handleListAgents();
			default:
				return {success: false, error: `Unknown tool: ${toolName}`};
		}
	} catch (err) {
		if (err instanceof zod.ZodError) {
			return {success: false, error: `Invalid parameters: ${err.message}`};
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Unknown error',
		};
	}
}
