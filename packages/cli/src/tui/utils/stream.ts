import {randomUUID} from 'node:crypto';
import {exec} from 'node:child_process';

// ── Open URL in browser ───────────────────────────────────────────────────────

export function openBrowser(url: string): void {
	const cmd =
		process.platform === 'darwin'
			? 'open'
			: process.platform === 'win32'
			? 'start'
			: 'xdg-open';
	exec(`${cmd} "${url}"`);
}

// ── Integration types ─────────────────────────────────────────────────────────

export interface IntegrationDefinition {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	spec: Record<string, unknown>;
}

export interface IntegrationAccount {
	id: string;
	integrationDefinitionId: string;
	integrationDefinition: {
		name: string;
		slug: string;
		frontendUrl?: string | null;
		spec?: Record<string, unknown> | null;
	};
	isActive: boolean;
}

export async function fetchIntegrationDefinitions(
	baseUrl: string,
	apiKey: string,
): Promise<IntegrationDefinition[]> {
	const res = await fetch(`${baseUrl}/api/v1/integration_definitions`, {
		headers: {Authorization: `Bearer ${apiKey}`},
	});
	if (!res.ok)
		throw new Error(`Failed to fetch definitions: ${res.statusText}`);
	const data = (await res.json()) as {definitions: IntegrationDefinition[]};
	return data.definitions ?? [];
}

export async function fetchIntegrationAccounts(
	baseUrl: string,
	apiKey: string,
): Promise<IntegrationAccount[]> {
	const res = await fetch(`${baseUrl}/api/v1/integration_account`, {
		headers: {Authorization: `Bearer ${apiKey}`},
	});
	if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.statusText}`);
	const data = (await res.json()) as {accounts: IntegrationAccount[]};
	return data.accounts ?? [];
}

export async function connectApiKeyIntegration(
	baseUrl: string,
	apiKey: string,
	integrationDefinitionId: string,
	key: string,
): Promise<void> {
	const res = await fetch(`${baseUrl}/api/v1/integration_account`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({integrationDefinitionId, apiKey: key}),
	});
	if (!res.ok) {
		const data = (await res.json().catch(() => ({}))) as {error?: string};
		throw new Error(data.error ?? res.statusText);
	}
}

// ── Event types matching the SSE JSON stream format ───────────────────────────

export type OutputPart = {
	type: string; // e.g. "tool-get_integration_actions", "text", "step-start"
	toolCallId?: string;
	state?:
		| 'input-streaming'
		| 'output-available'
		| 'output-denied'
		| 'output-error'
		| 'approval-requested'
		| 'approval-responded'
		| 'in-progress';
	input?: Record<string, unknown>;
	output?: unknown;
	text?: string;
	approval?: {id: string};
};

export type StreamEvent =
	| {type: 'text-start'; id: string}
	| {type: 'text-delta'; id: string; delta: string}
	| {type: 'text-end'; id: string}
	| {type: 'tool-input-start'; toolCallId: string; toolName: string}
	| {type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string}
	| {type: 'tool-input-end'; toolCallId: string}
	| {
			type: 'tool-input-available';
			toolCallId: string;
			toolName: string;
			input: Record<string, unknown>;
	  }
	| {
			type: 'tool-call';
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
	  }
	| {type: 'tool-result'; toolCallId: string; result: unknown}
	| {
			type: 'tool-output-available';
			toolCallId: string;
			// output can be {parts} or Mastra format {toolCalls, toolResults, steps}
			output: Record<string, unknown>;
			preliminary?: boolean;
	  }
	| {type: 'tool-approval-request'; approvalId: string; toolCallId: string}
	| {
			// Sub-agent activity chunks — carry nested tool calls/results for agent-take_action
			type: 'data-tool-agent';
			data?: {
				toolCalls?: Array<{
					toolCallId: string;
					toolName: string;
					args: Record<string, unknown>;
					payload?: {
						toolCallId: string;
						toolName: string;
						args: Record<string, unknown>;
					};
				}>;
				toolResults?: Array<{
					toolCallId: string;
					result?: unknown;
					payload?: {toolCallId: string; result?: unknown};
				}>;
				steps?: unknown[];
				text?: string;
			};
	  }
	| {type: 'finish-step'}
	| {type: 'finish-message'}
	| {type: 'finish'; finishReason?: string}
	| {type: 'error'; error: string};

// ── Parse a single SSE line ───────────────────────────────────────────────────

function parseSSELine(line: string): string | null {
	const trimmed = line.trim();
	if (trimmed.startsWith('data: ')) {
		return trimmed.slice(6);
	}

	return null;
}

// ── Shared SSE body reader ────────────────────────────────────────────────────

async function* readSSEBody(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const {done, value} = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, {stream: true});
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';

		for (const line of lines) {
			const data = parseSSELine(line);
			if (!data || data === '[DONE]') continue;

			try {
				const event = JSON.parse(data) as StreamEvent;
				yield event;
			} catch {
				// ignore malformed lines
			}
		}
	}
}

// ── Fetch workspace info ──────────────────────────────────────────────────────

export async function fetchWorkspace(
	baseUrl: string,
	apiKey: string,
): Promise<{id: string; name: string; accentColor: string} | null> {
	try {
		const res = await fetch(`${baseUrl}/api/v1/workspace`, {
			headers: {Authorization: `Bearer ${apiKey}`},
		});
		if (!res.ok) return null;
		return (await res.json()) as {
			id: string;
			name: string;
			accentColor: string;
		};
	} catch {
		return null;
	}
}

export async function fetchWorkspaceAvatar(
	baseUrl: string,
	apiKey: string,
): Promise<string | null> {
	try {
		const res = await fetch(`${baseUrl}/api/v1/workspace/avatar`, {
			headers: {Authorization: `Bearer ${apiKey}`},
		});
		if (!res.ok) return null;
		const buf = await res.arrayBuffer();
		return Buffer.from(buf).toString('base64');
	} catch {
		return null;
	}
}

// ── Stream conversation ───────────────────────────────────────────────────────

/**
 * Custom error thrown when the webapp refuses a chat turn because the
 * workspace is out of credits. `code === 'no_credits'` matches the JSON
 * body the webapp returns from both `/api/v1/conversation/create` and
 * `/api/v1/conversation`. Callers can distinguish it from generic HTTP
 * failures to render a friendly "top up" hint instead of a generic error.
 */
export class NoCreditsError extends Error {
	code = 'no_credits';
	constructor(message: string) {
		super(message);
		this.name = 'NoCreditsError';
	}
}

async function readErrorPayload(
	response: Response,
): Promise<{code?: string; error?: string}> {
	try {
		return (await response.json()) as {code?: string; error?: string};
	} catch {
		return {};
	}
}

export async function* streamConversation(
	baseUrl: string,
	apiKey: string,
	conversationId: string,
	message: string,
	signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
	const response = await fetch(`${baseUrl}/api/v1/conversation`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			id: conversationId,
			message: {
				id: randomUUID(),
				parts: [{text: message, type: 'text'}],
				role: 'user',
			},
			source: 'cli',
		}),
		signal,
	});

	if (response.status === 402) {
		const body = await readErrorPayload(response);
		if (body.code === 'no_credits') {
			throw new NoCreditsError(body.error ?? 'Out of credits.');
		}
	}

	if (!response.ok || !response.body) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	yield* readSSEBody(response.body);
}

// ── Stream approval response ──────────────────────────────────────────────────

export async function* streamConversationApproval(
	baseUrl: string,
	apiKey: string,
	conversationId: string,
	toolCallId: string,
	approved: boolean,
	signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
	const response = await fetch(`${baseUrl}/api/v1/conversation`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			id: conversationId,
			needsApproval: true,
			toolArgOverrides: {[toolCallId]: {approved}},
			source: 'cli',
		}),
		signal,
	});

	if (!response.ok || !response.body) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	yield* readSSEBody(response.body);
}

// ── Fetch conversations list ──────────────────────────────────────────────────

export interface ConversationSummary {
	id: string;
	title: string | null;
	updatedAt: string;
	source: string | null;
}

export interface ConversationsPage {
	conversations: ConversationSummary[];
	hasNext: boolean;
}

export async function fetchConversations(
	baseUrl: string,
	apiKey: string,
	page = 1,
	limit = 20,
	source?: 'cli' | undefined,
): Promise<ConversationsPage> {
	const params = new URLSearchParams({
		page: String(page),
		limit: String(limit),
	});
	if (source) params.set('source', source);

	const response = await fetch(
		`${baseUrl}/api/v1/conversations?${params.toString()}`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch conversations: ${response.statusText}`);
	}

	const data = (await response.json()) as {
		conversations: ConversationSummary[];
		pagination: {hasNext: boolean};
	};
	return {
		conversations: data.conversations ?? [],
		hasNext: data.pagination?.hasNext ?? false,
	};
}

// ── Pages (scratchpad) ────────────────────────────────────────────────────────

export interface PageRef {
	id: string;
	date: string;
}

/** GET /api/v1/page?date=YYYY-MM-DD — creates the page on-demand if missing. */
export async function fetchPageByDate(
	baseUrl: string,
	apiKey: string,
	dateISO: string,
): Promise<PageRef> {
	const response = await fetch(
		`${baseUrl}/api/v1/page?date=${encodeURIComponent(dateISO)}`,
		{headers: {Authorization: `Bearer ${apiKey}`}},
	);
	if (!response.ok) {
		throw new Error(`Failed to load scratchpad: ${response.statusText}`);
	}
	return (await response.json()) as PageRef;
}

/**
 * GET /api/v1/page/:pageId/content — HTML from last-persisted TipTap doc.
 *
 * Throws with a status-aware message when the endpoint is missing (older
 * webapp deployment) so the caller can distinguish "actually empty" from
 * "endpoint not available".
 */
export async function fetchPageContent(
	baseUrl: string,
	apiKey: string,
	pageId: string,
): Promise<string | null> {
	const response = await fetch(`${baseUrl}/api/v1/page/${pageId}/content`, {
		headers: {Authorization: `Bearer ${apiKey}`},
	});
	if (response.status === 404) {
		throw new Error(
			'Page-content endpoint missing (needs `/api/v1/page/:pageId/content` — restart webapp).',
		);
	}
	if (!response.ok) {
		throw new Error(`Failed to load page content: ${response.status} ${response.statusText}`);
	}
	const data = (await response.json()) as {html?: string | null};
	return data.html ?? null;
}

// ── Credits ───────────────────────────────────────────────────────────────────

export interface CreditsInfo {
	available: number;
	monthly: number;
	billingEnabled: boolean;
	byok: boolean;
}

/**
 * GET /api/v1/credits — workspace credit balance + billing flags.
 *
 * When `billingEnabled` is false OR `byok` is true, callers should treat the
 * workspace as always having credits. Otherwise `available` gates chat
 * requests just like the webapp's `hasCredits` server check.
 */
export async function fetchCredits(
	baseUrl: string,
	apiKey: string,
): Promise<CreditsInfo | null> {
	try {
		const response = await fetch(`${baseUrl}/api/v1/credits`, {
			headers: {Authorization: `Bearer ${apiKey}`},
		});
		if (!response.ok) return null;
		return (await response.json()) as CreditsInfo;
	} catch {
		return null;
	}
}

// ── Task runs (recurring task history) ───────────────────────────────────────

export interface TaskRunSummary {
	id: string;
	title: string | null;
	status: string | null;
	createdAt: string;
	updatedAt: string;
}

/**
 * Fetch all conversation "runs" for a task. Reuses the existing conversations
 * list endpoint with the `asyncJobId` filter — every run of a recurring
 * scheduled task creates a conversation whose `asyncJobId` matches the task
 * id (see `apps/webapp/app/services/conversation.server.ts:444-446`), so no
 * new endpoint is needed on the webapp side.
 */
export async function fetchTaskRuns(
	baseUrl: string,
	apiKey: string,
	taskId: string,
	limit = 50,
): Promise<TaskRunSummary[]> {
	const params = new URLSearchParams({
		asyncJobId: taskId,
		limit: String(limit),
	});
	const response = await fetch(
		`${baseUrl}/api/v1/conversations?${params.toString()}`,
		{headers: {Authorization: `Bearer ${apiKey}`}},
	);
	if (!response.ok) {
		throw new Error(`Failed to load task runs: ${response.statusText}`);
	}
	const data = (await response.json()) as {
		conversations?: Array<{
			id: string;
			title: string | null;
			status: string | null;
			createdAt: string;
			updatedAt: string;
		}>;
	};
	return (data.conversations ?? []).map(c => ({
		id: c.id,
		title: c.title,
		status: c.status,
		createdAt: c.createdAt,
		updatedAt: c.updatedAt,
	}));
}

// ── Voice inbox (catchup) ─────────────────────────────────────────────────────

/**
 * GET /api/v1/inbox?limit=1 → { count }
 *
 * Returns the number of unchecked `voiceInboxMessage` rows for the current
 * user. This is the same source the webapp's ButlerStatusPill and Mac inbox
 * pill both count — a distinct table from `conversations`, populated by
 * agent `send_message` outputs and cleared when the user runs `/catchup`
 * (`POST /api/v1/inbox/summarise` stamps `checked`).
 */
export async function fetchInboxCount(
	baseUrl: string,
	apiKey: string,
): Promise<number> {
	const response = await fetch(`${baseUrl}/api/v1/inbox?limit=1`, {
		headers: {Authorization: `Bearer ${apiKey}`},
	});
	if (!response.ok) return 0;
	const data = (await response.json()) as {count?: number};
	return data.count ?? 0;
}

/**
 * POST /api/v1/inbox/summarise — runs the LLM catchup summariser over the
 * user's unchecked inbox and marks the rows as caught up. Returns the summary
 * text (may be empty when there was nothing to catch up on).
 */
export async function summariseCatchup(
	baseUrl: string,
	apiKey: string,
): Promise<{summary: string; count: number}> {
	const response = await fetch(`${baseUrl}/api/v1/inbox/summarise`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to summarise catchup: ${response.statusText}`);
	}
	const data = (await response.json()) as {summary?: string; count?: number};
	return {summary: data.summary ?? '', count: data.count ?? 0};
}

// ── Gateways ──────────────────────────────────────────────────────────────────

export interface GatewaySummary {
	id: string;
	name: string;
	status: 'CONNECTED' | 'DISCONNECTED';
}

export async function fetchGateways(
	baseUrl: string,
	apiKey: string,
): Promise<GatewaySummary[]> {
	const response = await fetch(`${baseUrl}/api/v1/gateways`, {
		headers: {Authorization: `Bearer ${apiKey}`},
	});
	if (!response.ok) return [];
	const data = (await response.json()) as {gateways?: GatewaySummary[]};
	return data.gateways ?? [];
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

// The 6 user-settable statuses. The DB also has a `Recurring` enum value but
// it is effectively unused — recurring tasks live with their normal status.
// The "recurring" tab in the TUI is a CLIENT-SIDE filter on schedule +
// maxOccurrences (matches webapp pattern in home.tasks._index.tsx).
export type TaskStatusValue =
	| 'Todo'
	| 'Waiting'
	| 'Ready'
	| 'Working'
	| 'Review'
	| 'Done';

export interface TaskSummary {
	id: string;
	displayId: string | null;
	title: string;
	status: TaskStatusValue;
	createdAt: string;
	updatedAt: string;
	nextRunAt: string | null;
	schedule: string | null;
	maxOccurrences: number | null;
	conversationIds: string[];
}

export interface TaskDetail {
	id: string;
	displayId: string | null;
	title: string;
	status: TaskStatusValue;
	description: string | null; // HTML
	nextRunAt: string | null;
	schedule: string | null;
	subtaskCount?: number;
}

/**
 * Fetch tasks. If `status` is set, server filters by status. If unset, returns
 * all tasks (caller is responsible for any client-side filtering — e.g. the
 * TaskList component does this for the Recurring tab).
 */
export async function fetchTasks(
	baseUrl: string,
	apiKey: string,
	status?: TaskStatusValue,
): Promise<TaskSummary[]> {
	const params = new URLSearchParams();
	if (status) params.set('status', status);
	const url =
		`${baseUrl}/api/v1/tasks` +
		(params.toString() ? `?${params.toString()}` : '');

	const response = await fetch(url, {
		headers: {Authorization: `Bearer ${apiKey}`},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch tasks: ${response.statusText}`);
	}

	const data = (await response.json()) as TaskSummary[];
	return Array.isArray(data) ? data : [];
}

export async function fetchTaskDetail(
	baseUrl: string,
	apiKey: string,
	taskId: string,
): Promise<TaskDetail> {
	const response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
		headers: {Authorization: `Bearer ${apiKey}`},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch task: ${response.statusText}`);
	}

	return (await response.json()) as TaskDetail;
}

export async function updateTaskApi(
	baseUrl: string,
	apiKey: string,
	taskId: string,
	updates: {status?: TaskStatusValue; title?: string; description?: string},
): Promise<void> {
	const response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(updates),
	});

	if (!response.ok) {
		throw new Error(`Failed to update task: ${response.statusText}`);
	}
}

export async function createTaskApi(
	baseUrl: string,
	apiKey: string,
	input: {
		title: string;
		description?: string;
		status?: TaskStatusValue;
	},
): Promise<TaskSummary> {
	const response = await fetch(`${baseUrl}/api/v1/tasks`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			title: input.title,
			...(input.description ? {description: input.description} : {}),
			status: input.status ?? 'Todo',
			source: 'cli',
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to create task: ${response.statusText}`);
	}

	return (await response.json()) as TaskSummary;
}

/**
 * Predicate matching the webapp's recurring-badge rule
 * (apps/webapp/app/components/tasks/task-list-panel.tsx:141)
 * and the user's spec: has schedule AND (maxOccurrences null/unlimited OR > 1).
 */
export function isRecurringTask(t: TaskSummary): boolean {
	return !!t.schedule && (!t.maxOccurrences || t.maxOccurrences > 1);
}

// ── Fetch conversation history ────────────────────────────────────────────────

export interface HistoryPart {
	type: string;
	text?: string;
	// file parts
	mediaType?: string;
	filename?: string;
	url?: string;
	// tool parts
	toolCallId?: string;
	state?: string;
	input?: Record<string, unknown>;
	output?: unknown;
}

export interface HistoryMessage {
	id: string;
	role: 'user' | 'assistant';
	parts: HistoryPart[];
}

export interface ConversationDetail {
	messages: HistoryMessage[];
	incognito: boolean;
}

export async function fetchConversationHistory(
	baseUrl: string,
	apiKey: string,
	conversationId: string,
): Promise<ConversationDetail> {
	const response = await fetch(
		`${baseUrl}/api/v1/conversation/${conversationId}`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch conversation: ${response.statusText}`);
	}

	const data = (await response.json()) as {
		ConversationHistory: HistoryMessage[];
		incognito: boolean;
	};
	return {
		messages: data.ConversationHistory ?? [],
		incognito: data.incognito ?? false,
	};
}

// ── Create conversation ───────────────────────────────────────────────────────

export async function createConversationApi(
	baseUrl: string,
	apiKey: string,
	message: string,
	incognito: boolean,
): Promise<string> {
	const response = await fetch(`${baseUrl}/api/v1/conversation/create`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({message, source: 'cli', incognito}),
	});

	if (response.status === 402) {
		const body = await readErrorPayload(response);
		if (body.code === 'no_credits') {
			throw new NoCreditsError(body.error ?? 'Out of credits.');
		}
	}

	if (!response.ok) {
		throw new Error(`Failed to create conversation: ${response.statusText}`);
	}

	const data = (await response.json()) as {conversationId: string};
	return data.conversationId;
}
