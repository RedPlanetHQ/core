import zod from 'zod';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import type {GatewayTool} from './browser-tools';
import {
	getSession,
	updateSession,
	listSessions,
	createSession,
	closeSession as closeStoredSession,
} from '@/utils/coding-sessions';
import {
	getAgentConfig,
	buildStartArgs,
	buildResumeArgs,
	startAgentProcess,
	readProcessOutput,
	isProcessRunning,
	stopProcess,
} from '@/utils/coding-runner';

// ============ Zod Schemas ============

export const StartSessionSchema = zod.object({
	agent: zod.string(),
	prompt: zod.string(),
	dir: zod.string(),
	model: zod.string().optional(),
	systemPrompt: zod.string().optional(),
});

export const ResumeSessionSchema = zod.object({
	sessionId: zod.string(),
	prompt: zod.string(),
});

export const CloseSessionSchema = zod.object({
	sessionId: zod.string(),
});

export const ReadSessionSchema = zod.object({
	sessionId: zod.string(),
	lines: zod.number().optional(),
	offset: zod.number().optional(),
	tail: zod.boolean().optional(),
});

export const ListSessionsSchema = zod.object({});

// ============ JSON Schemas ============

const jsonSchemas: Record<string, Record<string, unknown>> = {
	coding_start_session: {
		type: 'object',
		properties: {
			agent: {
				type: 'string',
				description: 'Coding agent to use (e.g., "claude-code")',
			},
			prompt: {
				type: 'string',
				description: 'The task/prompt to send to the agent',
			},
			dir: {
				type: 'string',
				description: 'Working directory for the session (must exist)',
			},
			model: {
				type: 'string',
				description: 'Model to use (optional)',
			},
			systemPrompt: {
				type: 'string',
				description: 'System prompt (optional)',
			},
		},
		required: ['agent', 'prompt', 'dir'],
	},
	coding_resume_session: {
		type: 'object',
		properties: {
			sessionId: {
				type: 'string',
				description: 'Session ID to resume',
			},
			prompt: {
				type: 'string',
				description: 'The prompt to send to continue the session',
			},
		},
		required: ['sessionId', 'prompt'],
	},
	coding_close_session: {
		type: 'object',
		properties: {
			sessionId: {
				type: 'string',
				description: 'Session ID to close',
			},
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
			lines: {
				type: 'number',
				description: 'Number of lines to return (default: all)',
			},
			offset: {
				type: 'number',
				description: 'Line offset to start reading from (0-indexed, default: 0)',
			},
			tail: {
				type: 'boolean',
				description: 'If true, return the last N lines instead of first N (default: false)',
			},
		},
		required: ['sessionId'],
	},
	coding_list_sessions: {
		type: 'object',
		properties: {},
		required: [],
		description: 'List all coding sessions',
	},
};

// ============ Tool Definitions ============

export const codingTools: GatewayTool[] = [
	{
		name: 'coding_start_session',
		description: 'Start a new coding session with the specified agent (runs in background)',
		inputSchema: jsonSchemas.coding_start_session!,
	},
	{
		name: 'coding_resume_session',
		description: 'Resume an existing coding session',
		inputSchema: jsonSchemas.coding_resume_session!,
	},
	{
		name: 'coding_close_session',
		description: 'Close/stop a coding session',
		inputSchema: jsonSchemas.coding_close_session!,
	},
	{
		name: 'coding_read_session',
		description: 'Read current output from a coding session (works while running)',
		inputSchema: jsonSchemas.coding_read_session!,
	},
	{
		name: 'coding_list_sessions',
		description: 'List all coding sessions',
		inputSchema: jsonSchemas.coding_list_sessions!,
	},
];

// ============ Tool Handlers ============

async function handleStartSession(params: zod.infer<typeof StartSessionSchema>) {
	// Check if directory exists
	if (!existsSync(params.dir)) {
		return {
			success: false,
			error: `Directory "${params.dir}" does not exist`,
		};
	}

	// Get agent config
	const config = getAgentConfig(params.agent);
	if (!config) {
		return {
			success: false,
			error: `Agent "${params.agent}" not configured. Run 'corebrain coding config --agent ${params.agent}' to set up.`,
		};
	}

	// Generate session ID and create session
	const sessionId = randomUUID();
	const session = createSession({
		sessionId,
		agent: params.agent,
		prompt: params.prompt,
		dir: params.dir,
	});
	updateSession(session);

	// Build command args
	const args = buildStartArgs(config, {
		prompt: params.prompt,
		sessionId,
		model: params.model,
		systemPrompt: params.systemPrompt,
	});

	// Start process in background
	const {pid} = startAgentProcess(sessionId, config, args, params.dir);

	return {
		success: true,
		result: {
			sessionId,
			pid,
			status: 'running',
			message: 'Session started. Use coding_read_session to check output.',
		},
	};
}

async function handleResumeSession(params: zod.infer<typeof ResumeSessionSchema>) {
	// Get existing session
	const session = getSession(params.sessionId);
	if (!session) {
		return {
			success: false,
			error: `Session "${params.sessionId}" not found`,
		};
	}

	// Check if already running
	if (isProcessRunning(params.sessionId)) {
		return {
			success: false,
			error: `Session "${params.sessionId}" is already running`,
		};
	}

	// Check if directory still exists
	if (!existsSync(session.dir)) {
		return {
			success: false,
			error: `Session directory "${session.dir}" no longer exists`,
		};
	}

	// Get agent config
	const config = getAgentConfig(session.agent);
	if (!config) {
		return {
			success: false,
			error: `Agent "${session.agent}" not configured`,
		};
	}

	// Update session status
	session.status = 'running';
	session.prompt = params.prompt;
	session.updatedAt = Date.now();
	updateSession(session);

	// Build resume args
	const args = buildResumeArgs(config, {
		prompt: params.prompt,
		sessionId: params.sessionId,
	});

	// Start process in background
	const {pid} = startAgentProcess(params.sessionId, config, args, session.dir);

	return {
		success: true,
		result: {
			sessionId: params.sessionId,
			pid,
			status: 'running',
			message: 'Session resumed. Use coding_read_session to check output.',
		},
	};
}

function handleCloseSession(params: zod.infer<typeof CloseSessionSchema>) {
	const session = getSession(params.sessionId);
	if (!session) {
		return {
			success: false,
			error: `Session "${params.sessionId}" not found`,
		};
	}

	// Stop the process if running (this triggers auto-save in runner)
	const wasRunning = stopProcess(params.sessionId);

	// Mark as closed in sessions.json
	closeStoredSession(params.sessionId);

	return {
		success: true,
		result: {
			sessionId: params.sessionId,
			wasRunning,
			message: 'Session closed',
		},
	};
}

/**
 * Apply line slicing to output
 */
function sliceOutput(
	output: string,
	options: {lines?: number; offset?: number; tail?: boolean},
): {sliced: string; totalLines: number; returnedLines: number} {
	const allLines = output.split('\n');
	const totalLines = allLines.length;

	if (!options.lines && !options.offset) {
		return {sliced: output, totalLines, returnedLines: totalLines};
	}

	let resultLines: string[];

	if (options.tail && options.lines) {
		// Get last N lines
		const start = Math.max(0, totalLines - options.lines);
		resultLines = allLines.slice(start);
	} else {
		// Get lines from offset with limit
		const offset = options.offset || 0;
		const limit = options.lines || totalLines;
		resultLines = allLines.slice(offset, offset + limit);
	}

	return {
		sliced: resultLines.join('\n'),
		totalLines,
		returnedLines: resultLines.length,
	};
}

function handleReadSession(params: zod.infer<typeof ReadSessionSchema>) {
	// First check stored session exists
	const session = getSession(params.sessionId);
	if (!session) {
		return {
			success: false,
			error: `Session "${params.sessionId}" not found`,
		};
	}

	// Read from running process
	const output = readProcessOutput(params.sessionId);

	const sliceOptions = {
		lines: params.lines,
		offset: params.offset,
		tail: params.tail,
	};

	if (output.found) {
		// Process is tracked in memory, return live output
		const status = output.running
			? 'running'
			: output.exitCode === 0
				? 'completed'
				: 'error';

		const {sliced, totalLines, returnedLines} = sliceOutput(
			output.stdout,
			sliceOptions,
		);

		return {
			success: true,
			result: {
				sessionId: session.sessionId,
				agent: session.agent,
				prompt: session.prompt,
				dir: session.dir,
				status,
				running: output.running,
				output: sliced,
				error: output.stderr || undefined,
				exitCode: output.exitCode,
				startedAt: session.startedAt,
				updatedAt: session.updatedAt,
				totalLines,
				returnedLines,
			},
		};
	}

	// Process not in memory, return stored session data from sessions.json
	const {sliced, totalLines, returnedLines} = sliceOutput(
		session.output || '',
		sliceOptions,
	);

	return {
		success: true,
		result: {
			sessionId: session.sessionId,
			agent: session.agent,
			prompt: session.prompt,
			dir: session.dir,
			status: session.status,
			running: false,
			output: sliced,
			error: session.error,
			exitCode: null,
			startedAt: session.startedAt,
			updatedAt: session.updatedAt,
			totalLines,
			returnedLines,
		},
	};
}

function handleListSessions() {
	const sessions = listSessions();
	return {
		success: true,
		result: {
			sessions: sessions.map((s) => {
				// Check if process is still running
				const running = isProcessRunning(s.sessionId);
				return {
					sessionId: s.sessionId,
					agent: s.agent,
					dir: s.dir,
					status: running ? 'running' : s.status,
					running,
					startedAt: s.startedAt,
					updatedAt: s.updatedAt,
				};
			}),
			count: sessions.length,
		},
	};
}

// ============ Tool Execution ============

export async function executeCodingTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	try {
		switch (toolName) {
			case 'coding_start_session':
				return await handleStartSession(StartSessionSchema.parse(params));

			case 'coding_resume_session':
				return await handleResumeSession(ResumeSessionSchema.parse(params));

			case 'coding_close_session':
				return handleCloseSession(CloseSessionSchema.parse(params));

			case 'coding_read_session':
				return handleReadSession(ReadSessionSchema.parse(params));

			case 'coding_list_sessions':
				ListSessionsSchema.parse(params);
				return handleListSessions();

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
