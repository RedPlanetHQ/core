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
		| 'approval-requested'
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

// ── Fetch reminders ───────────────────────────────────────────────────────────

export interface ReminderSummary {
	id: string;
	text: string;
	schedule: string;
	channel: string;
	isActive: boolean;
	nextRunAt: string | null;
	occurrenceCount: number;
	maxOccurrences: number | null;
	createdAt: string;
}

export interface RemindersPage {
	reminders: ReminderSummary[];
	hasMore: boolean;
	nextCursor: string | null;
}

export async function fetchReminders(
	baseUrl: string,
	apiKey: string,
	cursor?: string,
	isActive?: 'true' | 'false',
	limit = 25,
): Promise<RemindersPage> {
	const params = new URLSearchParams({limit: String(limit)});
	if (cursor) params.set('cursor', cursor);
	if (isActive !== undefined) params.set('isActive', isActive);

	const response = await fetch(
		`${baseUrl}/api/v1/reminders?${params.toString()}`,
		{
			headers: {Authorization: `Bearer ${apiKey}`},
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch reminders: ${response.statusText}`);
	}

	const data = (await response.json()) as {
		reminders: ReminderSummary[];
		hasMore: boolean;
		nextCursor: string | null;
	};
	return {
		reminders: data.reminders ?? [],
		hasMore: data.hasMore ?? false,
		nextCursor: data.nextCursor ?? null,
	};
}

// ── Fetch conversation history ────────────────────────────────────────────────

export interface HistoryMessage {
	id: string;
	role: 'user' | 'assistant';
	parts: Array<{type: string; text?: string}>;
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

	if (!response.ok) {
		throw new Error(`Failed to create conversation: ${response.statusText}`);
	}

	const data = (await response.json()) as {conversationId: string};
	return data.conversationId;
}
