import zod from 'zod';
import {randomUUID, createHash} from 'node:crypto';
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, cpSync, realpathSync} from 'node:fs';
import {resolve, basename} from 'node:path';
import {homedir} from 'node:os';
import type {GatewayTool} from './browser-tools';
import {getPreferences} from '@/config/preferences';
import {listFolders, resolveFolderForPath} from '@/config/folders';
import {folderScopeError} from './scope-error';
import {
	getSession,
	upsertSession,
	deleteSession,
	listRunningSessions,
} from '@/utils/coding-sessions';
import {
	getAgentConfig,
	buildStartArgs,
	buildResumeArgs,
	startAgentProcess,
	isProcessRunning,
	stopProcess,
	type Logger,
} from '@/utils/coding-runner';
import {gatewayLog} from '@/server/gateway-log';
import {
	readAgentSessionTurns,
	agentSessionUpdatedSince,
	getAgentReader,
	scanAllSessions,
	searchSessions,
	findLatestCodexSession,
} from '@/utils/coding-agents';
import {ptyManager} from '@/server/pty/manager';

// ============ Schemas ============

const AskSchema = zod.object({
	agent: zod.string().optional(),
	prompt: zod.string(),
	dir: zod.string(),
	sessionId: zod.string().optional(),
	model: zod.string().optional(),
	systemPrompt: zod.string().optional(),
	worktree: zod.boolean().optional().default(false),
	baseBranch: zod.string().optional(),
	branch: zod.string().optional(),
});

const CloseSessionSchema = zod.object({
	sessionId: zod.string(),
});

const ReadSessionSchema = zod.object({
	sessionId: zod.string(),
});

const ListSessionsSchema = zod.object({
	agent: zod.string().optional(), // e.g. "claude-code" or "codex-cli"
	since: zod.string().optional(), // ISO date string e.g. "2024-01-01"
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
				description:
					'Working directory for the session. Must exist and (when folders are registered) resolve to a folder registered via `corebrain folder add` with the `coding` scope.',
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
			worktree: {
				type: 'boolean',
				description:
					'Create an isolated git worktree for this session (default: false)',
			},
			baseBranch: {
				type: 'string',
				description:
					'Existing branch to base the new worktree branch from (required when worktree is true)',
			},
			branch: {
				type: 'string',
				description:
					'New branch name to create in the worktree (required when worktree is true)',
			},
		},
		required: ['prompt', 'dir'],
	},
	coding_close_session: {
		type: 'object',
		properties: {
			sessionId: {type: 'string', description: 'Session ID to close'},
		},
		required: ['sessionId'],
	},
	coding_close_all: {
		type: 'object',
		properties: {},
	},
	coding_read_session: {
		type: 'object',
		properties: {
			sessionId: {
				type: 'string',
				description: 'Session ID to read output from',
			},
		},
		required: ['sessionId'],
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
			'Send a prompt to a coding agent. Omit sessionId to start a new session; include it to continue an existing one. After calling, use coding_read_session to check output. When worktree=true, the tool handles branch/worktree creation automatically — do NOT include worktree setup instructions in the prompt. The prompt should only describe the task to perform.',
		inputSchema: jsonSchemas.coding_ask!,
	},
	{
		name: 'coding_close_session',
		description: 'Stop a running coding session',
		inputSchema: jsonSchemas.coding_close_session!,
	},
	{
		name: 'coding_close_all',
		description:
			'Stop all running coding sessions and clean up their worktrees',
		inputSchema: jsonSchemas.coding_close_all!,
	},
	{
		name: 'coding_read_session',
		description:
			'Read conversation turns (user/assistant messages) from a coding session. Returns structured turns instead of raw log lines. The `status` field is one of: "initializing" (agent booting, transcript not yet written), "running" (agent process alive and writing), "completed" (process exited with a transcript), "failed" (process exited without any transcript).',
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

// ============ Live TUI Prompt Injection ============

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Inject a prompt into a live claude-code TUI as if the user typed it.
 *
 * Why this is gnarly: claude-code's input box treats CR that arrives in the
 * same byte burst as the text as a literal newline (multi-line composition),
 * not as submit. Real terminals submit because the keypress for Enter arrives
 * as its own write after the typed/pasted text settles.
 *
 * Approach: send the prompt inside a bracketed-paste sequence (so embedded
 * newlines in the prompt stay literal and don't accidentally submit early),
 * give the renderer a tick to absorb it, then send a standalone CR for submit.
 * Returns false if the PTY went away mid-write so the caller can fall back.
 */
async function submitPromptToLiveTui(
	sessionId: string,
	prompt: string,
): Promise<boolean> {
	// Bracketed-paste markers — Claude (and most modern TUIs) recognize these
	// and route the enclosed bytes to the input buffer without interpreting
	// embedded newlines as submit.
	const PASTE_START = '\x1b[200~';
	const PASTE_END = '\x1b[201~';

	if (!ptyManager.write(sessionId, PASTE_START + prompt + PASTE_END)) {
		return false;
	}
	// Let the TUI render the paste before submit. Without the gap, Claude
	// occasionally swallows the CR as part of the paste burst.
	await sleep(80);
	if (!ptyManager.write(sessionId, '\r')) {
		return false;
	}
	return true;
}

// ============ Worktree Helpers ============

function resolvedHomedir(): string {
	try { return realpathSync(homedir()); } catch { return homedir(); }
}

const CB_WORKTREES_ROOT = resolve(resolvedHomedir(), '.corebrain', 'worktrees');

/**
 * Stable per-repo namespace under the corebrain home: `<basename>-<sha8>`.
 * Basename keeps it human-skimmable; the hash of the real path makes sure two
 * different repos that share a basename don't collide.
 */
function repoWorktreeNamespace(repoDir: string): string {
	let abs: string;
	try {
		abs = realpathSync(resolve(repoDir));
	} catch {
		abs = resolve(repoDir);
	}
	const base = basename(abs) || 'repo';
	const hash = createHash('sha256').update(abs).digest('hex').slice(0, 8);
	return `${base}-${hash}`;
}

function setupWorktree(
	dir: string,
	baseBranch: string,
	branch: string,
): {worktreePath: string; worktreeBranch: string} | {error: string} {
	const encodedBranch = branch.replace(/\//g, '-');
	const worktreePath = resolve(
		CB_WORKTREES_ROOT,
		repoWorktreeNamespace(dir),
		encodedBranch,
	);

	// If the worktree already exists (valid git worktree), reuse it so multiple
	// sessions can run against the same branch without hitting "already checked out".
	if (existsSync(resolve(worktreePath, '.git'))) {
		const sourceClaude = resolve(dir, '.claude');
		const destClaude = resolve(worktreePath, '.claude');
		if (existsSync(sourceClaude) && !existsSync(destClaude)) {
			try {
				cpSync(sourceClaude, destClaude, {recursive: true});
			} catch {
				// Non-fatal
			}
		}
		return {worktreePath, worktreeBranch: branch};
	}

	try {
		mkdirSync(worktreePath, {recursive: true});
		execSync(
			`git -C ${JSON.stringify(dir)} worktree add ${JSON.stringify(
				worktreePath,
			)} -b ${JSON.stringify(branch)} ${JSON.stringify(baseBranch)}`,
			{stdio: 'pipe'},
		);
		// Copy .claude settings to worktree so plugins are available
		const sourceClaude = resolve(dir, '.claude');
		const destClaude = resolve(worktreePath, '.claude');
		if (existsSync(sourceClaude) && !existsSync(destClaude)) {
			try {
				cpSync(sourceClaude, destClaude, {recursive: true});
			} catch {
				// Non-fatal — plugins just won't be available
			}
		}

		return {worktreePath, worktreeBranch: branch};
	} catch (err) {
		const stderr = (err as {stderr?: Buffer}).stderr?.toString().trim();
		return {
			error: `Failed to create worktree: ${
				stderr || (err instanceof Error ? err.message : String(err))
			}`,
		};
	}
}

function removeWorktree(
	worktreePath: string,
	repoDir: string,
): {removed: boolean; uncommitted: boolean} {
	try {
		const status = execSync(
			`git -C ${JSON.stringify(worktreePath)} status --porcelain`,
			{stdio: 'pipe'},
		)
			.toString()
			.trim();
		if (status.length > 0) {
			return {removed: false, uncommitted: true};
		}
		execSync(
			`git -C ${JSON.stringify(repoDir)} worktree remove ${JSON.stringify(
				worktreePath,
			)}`,
			{stdio: 'pipe'},
		);
		return {removed: true, uncommitted: false};
	} catch {
		return {removed: false, uncommitted: false};
	}
}

// ============ Handlers ============

async function waitForProcessExit(
	sessionId: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isProcessRunning(sessionId)) return true;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	return !isProcessRunning(sessionId);
}

async function handleAsk(
	params: zod.infer<typeof AskSchema>,
	logger: Logger = gatewayLog,
) {
	if (!existsSync(params.dir)) {
		return {success: false, error: `Directory "${params.dir}" does not exist`};
	}

	// Scope enforcement: coding requires a folder with `coding` scope
	if (listFolders().length > 0) {
		const resolved = resolveFolderForPath(params.dir, 'coding');
		if (!resolved) {
			const err = folderScopeError(params.dir, 'coding');
			return {
				success: false,
				error: `${err.error.code}: ${err.error.message}`,
			};
		}
	}

	if (params.worktree && (!params.baseBranch || !params.branch)) {
		return {
			success: false,
			error:
				'Parameters "baseBranch" and "branch" are required when worktree is true',
		};
	}

	const resolved = resolveAgent(params.agent);
	if ('error' in resolved) return {success: false, error: resolved.error};
	const agentName = resolved.agent;

	let config = getAgentConfig(agentName);
	if (!config) {
		return {
			success: false,
			error: `Agent "${agentName}" not configured. Run 'corebrain coding config --agent ${agentName}' to set up.`,
		};
	}

	const isResume = Boolean(params.sessionId);
	let sessionId = params.sessionId || randomUUID();

	// On resume, if a previous PTY is still alive for this id, kill it before
	// respawning. The TUI has no API to inject a new prompt into a running
	// instance, so the only way to deliver `params.prompt` is a fresh
	// `--resume <id>` process. SIGTERM gives the agent a chance to flush its
	// transcript; we escalate to SIGKILL only if it doesn't exit in time.
	if (isResume && isProcessRunning(sessionId)) {
		logger(`coding_ask resume: killing running pty for sessionId=${sessionId}`);
		stopProcess(sessionId);
		let exited = await waitForProcessExit(sessionId, 5_000);
		if (!exited) {
			logger(`coding_ask resume: SIGTERM did not exit, escalating to SIGKILL`);
			ptyManager.kill(sessionId, 'SIGKILL');
			exited = await waitForProcessExit(sessionId, 2_000);
		}
		if (!exited) {
			return {
				success: false,
				error: `Session "${sessionId}" did not exit after SIGTERM/SIGKILL — cannot resume.`,
			};
		}
	}

	// Set up worktree for new sessions when requested
	let workingDir = params.dir;
	let worktreePath: string | undefined;
	let worktreeBranch: string | undefined;

	// On resume, use the stored worktree path so we don't run in the main repo.
	// Fall back to scanning agent session files — the session dir is embedded in the
	// file path (claude-code) or session_meta (codex), so we can recover it even
	// after the running-session record has been cleaned up.
	if (isResume) {
		const storedSession = getSession(sessionId);
		if (storedSession?.worktreePath) {
			workingDir = storedSession.worktreePath;
			worktreePath = storedSession.worktreePath;
			worktreeBranch = storedSession.worktreeBranch;
		} else {
			const {sessions: allSessions} = await scanAllSessions({});
			const scanned = allSessions.find(s => s.sessionId === sessionId);
			if (scanned?.dir) {
				workingDir = scanned.dir;
			}
		}
	}

	if (params.worktree && !isResume) {
		const wt = setupWorktree(params.dir, params.baseBranch!, params.branch!);
		if ('error' in wt) return {success: false, error: wt.error};
		worktreePath = wt.worktreePath;
		worktreeBranch = wt.worktreeBranch;
		workingDir = wt.worktreePath;

		// codex sandboxes writes to the project dir — bypass it for worktree runs
		if (agentName === 'codex-cli') {
			config = {
				...config,
				args: [
					...(config.args ?? []),
					'--dangerously-bypass-approvals-and-sandbox',
				],
			};
		}
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
	upsertSession({
		sessionId,
		agent: agentName,
		dir: params.dir,
		startedAt,
		worktreePath,
		worktreeBranch,
	});

	const {pid, error} = startAgentProcess(
		sessionId,
		config,
		args,
		workingDir,
		logger,
		agentName,
	);

	if (error) {
		if (worktreePath) removeWorktree(worktreePath, params.dir);
		deleteSession(sessionId);
		return {success: false, error: `Failed to start: ${error}`};
	}

	// Store pid
	upsertSession({
		sessionId,
		agent: agentName,
		dir: params.dir,
		pid,
		startedAt,
		worktreePath,
		worktreeBranch,
	});

	// Wait until the agent has produced output.
	// - New session: the PTY has emitted any bytes (lastActivity > startedAt) — works
	//   for both claude-code and codex, regardless of whether the agent has written
	//   its own transcript file yet.
	// - Resume: the agent's transcript file has been touched (mtime > startedAt). The
	//   file pre-exists from the original run, so PTY activity alone isn't enough —
	//   the resumed process must actually write new turns.
	const hasReader = getAgentReader(agentName) !== null;
	if (hasReader) {
		const deadline = Date.now() + 30_000;
		const isReady = () => {
			if (isResume) {
				return agentSessionUpdatedSince(
					agentName,
					workingDir,
					sessionId,
					startedAt,
				);
			}
			const lastActivity = ptyManager.getLastActivity(sessionId);
			return Boolean(lastActivity && lastActivity > startedAt);
		};

		const sessionReady = await new Promise<boolean>(resolve => {
			function check() {
				if (isReady()) return resolve(true);
				if (!isProcessRunning(sessionId)) return resolve(isReady());
				if (Date.now() >= deadline) return resolve(isReady());
				setTimeout(check, 500);
			}
			setTimeout(check, 500);
		});

		if (!sessionReady) {
			stopProcess(sessionId);
			if (worktreePath && !isResume) removeWorktree(worktreePath, params.dir);
			deleteSession(sessionId);
			return {
				success: false,
				error: isResume
					? 'Resume failed: agent did not write to the session transcript within 30 seconds'
					: 'Session failed to start: agent did not produce output within 30 seconds',
			};
		}

		// For codex-cli on a new session: find the actual session ID codex assigned
		// (its own UUID in the filename) and re-key our running session record to use it.
		if (agentName === 'codex-cli' && !isResume) {
			const found = await findLatestCodexSession(workingDir, startedAt);

			if (found && found.sessionId !== sessionId) {
				sessionId = found.sessionId;
				upsertSession({
					sessionId: found.sessionId,
					agent: agentName,
					dir: params.dir,
					pid,
					startedAt,
					worktreePath,
					worktreeBranch,
				});
				return {
					success: true,
					result: {
						sessionId: found.sessionId,
						pid,
						resumed: isResume,
						message:
							'Session started. Poll with sleep(60) + coding_read_session, up to 3 times. If still running, use reschedule_self(10) for long polling.',
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
			message:
				'Session started. Poll with sleep(60) + coding_read_session, up to 3 times. If still running, use reschedule_self(10) for long polling.',
			...(worktreePath ? {worktreePath, worktreeBranch} : {}),
		},
	};
}

function handleCloseSession(params: zod.infer<typeof CloseSessionSchema>) {
	const session = getSession(params.sessionId);
	stopProcess(params.sessionId);
	deleteSession(params.sessionId);

	if (session?.worktreePath) {
		const {removed, uncommitted} = removeWorktree(
			session.worktreePath,
			session.dir,
		);
		if (!removed && uncommitted) {
			return {
				success: true,
				result: {
					sessionId: params.sessionId,
					message: `Session closed. Worktree preserved at ${session.worktreePath} — uncommitted changes detected.`,
					worktreePath: session.worktreePath,
					worktreeBranch: session.worktreeBranch,
				},
			};
		}
	}

	return {
		success: true,
		result: {sessionId: params.sessionId, message: 'Session closed'},
	};
}

function handleCloseAll() {
	const sessions = listRunningSessions();
	const results: Array<{
		sessionId: string;
		message: string;
		worktreePath?: string;
		worktreeBranch?: string;
	}> = [];

	for (const session of sessions) {
		stopProcess(session.sessionId);
		deleteSession(session.sessionId);

		if (session.worktreePath) {
			const {removed, uncommitted} = removeWorktree(
				session.worktreePath,
				session.dir,
			);
			if (!removed && uncommitted) {
				results.push({
					sessionId: session.sessionId,
					message: `Closed. Worktree preserved — uncommitted changes detected.`,
					worktreePath: session.worktreePath,
					worktreeBranch: session.worktreeBranch,
				});
				continue;
			}
		}

		results.push({sessionId: session.sessionId, message: 'Closed'});
	}

	return {
		success: true,
		result: {closed: results.length, sessions: results},
	};
}

async function handleReadSession(params: zod.infer<typeof ReadSessionSchema>) {
	const running = isProcessRunning(params.sessionId);

	// Resolve dir by scanning — most reliable since it reads the actual filesystem
	const stored = getSession(params.sessionId);
	const {sessions: allSessions} = await scanAllSessions({});
	const scanned = allSessions.find(s => s.sessionId === params.sessionId);

	// Prefer scanned dir (real cwd from JSONL) > stored worktreePath > stored dir.
	// Scanned dir wins because Claude Code resolves symlinks when writing the cwd
	// field, so it is always the canonical path — unlike stored.worktreePath which
	// may have been computed from a symlinked homedir.
	const sessionDir = scanned?.dir ?? stored?.worktreePath ?? stored?.dir;

	if (!sessionDir) {
		return {success: false, error: `Session "${params.sessionId}" not found`};
	}

	// Detect agent: running store → reader probe → default
	const agent = detectAgentForSession(params.sessionId, sessionDir);

	const {
		turns,
		totalLines,
		fileExists,
		fileSizeBytes,
		fileSizeHuman,
		error: readError,
	} = await readAgentSessionTurns(agent, sessionDir, params.sessionId);

	let status: string;
	let statusMessage: string | undefined;

	// 30s grace window before we flip initializing → failed when the process is gone
	// but no transcript was ever written. Matches handleAsk's ready-wait deadline.
	const INIT_GRACE_MS = 30_000;

	if (running && !fileExists) {
		status = 'initializing';
		statusMessage = 'Agent is booting. Wait a few seconds and read again.';
	} else if (running) {
		status = 'running';
	} else if (!fileExists && stored?.startedAt) {
		// Process is gone and produced no transcript. Don't lie with "completed".
		if (stored) deleteSession(params.sessionId);
		if (Date.now() - stored.startedAt < INIT_GRACE_MS) {
			status = 'initializing';
			statusMessage = 'Agent is booting. Wait a few seconds and read again.';
		} else {
			status = 'failed';
			statusMessage =
				'Agent exited before writing any output to the session transcript.';
		}
	} else {
		// Process finished — clean up running session record
		if (stored) deleteSession(params.sessionId);
		status = 'completed';
	}

	return {
		success: true,
		result: {
			sessionId: params.sessionId,
			dir: sessionDir,
			status,
			...(statusMessage ? {statusMessage} : {}),
			running,
			turns,
			error: readError,
			totalLines,
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
			case 'coding_close_all':
				return handleCloseAll();
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
