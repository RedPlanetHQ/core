import {randomUUID} from 'node:crypto';

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

// ── Create conversation ───────────────────────────────────────────────────────

export async function createConversationApi(
	baseUrl: string,
	apiKey: string,
	message: string,
): Promise<string> {
	const response = await fetch(`${baseUrl}/api/v1/conversation/create`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({message, source: 'cli'}),
	});

	if (!response.ok) {
		throw new Error(`Failed to create conversation: ${response.statusText}`);
	}

	const data = (await response.json()) as {conversationId: string};
	return data.conversationId;
}
