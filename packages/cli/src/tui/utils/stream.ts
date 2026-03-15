import {randomUUID} from 'node:crypto';
import {exec} from 'node:child_process';

// ── Open URL in browser ───────────────────────────────────────────────────────

export function openBrowser(url: string): void {
	const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
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
	integrationDefinition: {name: string; slug: string};
	isActive: boolean;
}

export async function fetchIntegrationDefinitions(
	baseUrl: string,
	apiKey: string,
): Promise<IntegrationDefinition[]> {
	const res = await fetch(`${baseUrl}/api/v1/integration_definitions`, {
		headers: {Authorization: `Bearer ${apiKey}`},
	});
	if (!res.ok) throw new Error(`Failed to fetch definitions: ${res.statusText}`);
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
		headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
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
	state?: 'input-streaming' | 'output-available';
	input?: Record<string, unknown>;
	output?: unknown;
	text?: string;
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
			output: {parts?: OutputPart[]};
			preliminary?: boolean;
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

// ── Stream conversation ───────────────────────────────────────────────────────

export async function* streamConversation(
	baseUrl: string,
	apiKey: string,
	conversationId: string,
	message: string,
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
	});

	if (!response.ok || !response.body) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	const reader = response.body.getReader();
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

export async function fetchConversationHistory(
	baseUrl: string,
	apiKey: string,
	conversationId: string,
): Promise<HistoryMessage[]> {
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
	};
	return data.ConversationHistory ?? [];
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
