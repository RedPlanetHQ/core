import {createConversationApi, streamConversation} from '../utils/stream.js';
import {ToolCallItem} from '../components/tool-call-item.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConversationCallbacks {
	onTextDelta: (delta: string) => void;
	onToolStart?: (id: string, name: string, item: ToolCallItem) => void;
	onRerender?: () => void;
	onStepFinish?: () => void;
	onFinish?: () => void;
	onError?: (err: Error) => void;
}

export interface Conversation {
	readonly conversationId: string | null;
	send(message: string, callbacks: ConversationCallbacks): Promise<void>;
	clear(): void;
	resume(id: string): void;
}

// Tools whose sub-calls should be shown as nested children
const CONTAINER_TOOLS = new Set(['gather_context', 'take_action']);

// ── Factory (hook-like, no React required) ────────────────────────────────────

export function createConversation(
	baseUrl: string,
	apiKey: string,
): Conversation {
	let conversationId: string | null = null;

	return {
		get conversationId() {
			return conversationId;
		},

		clear() {
			conversationId = null;
		},

		resume(id: string) {
			conversationId = id;
		},

		async send(message: string, callbacks: ConversationCallbacks) {
			try {
				if (!conversationId) {
					conversationId = await createConversationApi(
						baseUrl,
						apiKey,
						message,
					);
				}

				const activeTools = new Map<string, ToolCallItem>();
				// The currently-running container tool (gather_context / take_action)
				let activeParent: {id: string; item: ToolCallItem} | null = null;

				for await (const event of streamConversation(
					baseUrl,
					apiKey,
					conversationId,
					message,
				)) {
					switch (event.type) {
						case 'text-delta': {
							callbacks.onTextDelta(event.delta);
							break;
						}

						case 'tool-input-start': {
							const item = new ToolCallItem(event.toolName);
							activeTools.set(event.toolCallId, item);

							if (CONTAINER_TOOLS.has(event.toolName)) {
								// Container tool — show at top level, track as parent
								activeParent = {id: event.toolCallId, item};
								callbacks.onToolStart?.(event.toolCallId, event.toolName, item);
							} else if (activeParent) {
								// Nested tool — attach as child of the active container
								activeParent.item.addChild(item);
								callbacks.onRerender?.();
							} else {
								callbacks.onToolStart?.(event.toolCallId, event.toolName, item);
							}

							break;
						}

						case 'tool-input-delta': {
							activeTools
								.get(event.toolCallId)
								?.appendArgsDelta(event.inputTextDelta);
							callbacks.onRerender?.();
							break;
						}

						case 'tool-call': {
							// Non-streaming complete tool call
							const item = new ToolCallItem(event.toolName);
							item.setArgs(event.args);
							activeTools.set(event.toolCallId, item);

							if (CONTAINER_TOOLS.has(event.toolName)) {
								activeParent = {id: event.toolCallId, item};
								callbacks.onToolStart?.(event.toolCallId, event.toolName, item);
							} else if (activeParent) {
								item.setDone();
								activeParent.item.addChild(item);
								callbacks.onRerender?.();
							} else {
								callbacks.onToolStart?.(event.toolCallId, event.toolName, item);
							}

							break;
						}

						case 'tool-output-available': {
							// Streaming output from gather_context / take_action —
							// output.parts[] carries nested tool states in real-time
							const parentItem = activeTools.get(event.toolCallId);
							if (parentItem && event.output?.parts) {
								parentItem.updateFromOutputParts(event.output.parts);
							}

							// Mark parent done on final (non-preliminary) update
							if (!event.preliminary && activeParent?.id === event.toolCallId) {
								parentItem?.setDone();
								activeParent = null;
							}

							callbacks.onRerender?.();
							break;
						}

						case 'tool-result': {
							const item = activeTools.get(event.toolCallId);
							if (item) {
								item.setDone(event.result);
								if (activeParent?.id === event.toolCallId) {
									activeParent = null;
								}
							}

							callbacks.onRerender?.();
							break;
						}

						case 'finish-step': {
							for (const item of activeTools.values()) {
								item.setDone();
							}

							activeParent = null;
							activeTools.clear();
							callbacks.onStepFinish?.();
							break;
						}

						case 'error': {
							// AI SDK emits "terminated" as a normal end-of-stream signal
							if (event.error === 'terminated') break;
							callbacks.onError?.(new Error(event.error));
							break;
						}

						default:
							break;
					}
				}

				// Stream ended — fire finish once
				callbacks.onFinish?.();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				// undici throws "terminated" when the server closes the SSE connection normally
				if (message === 'terminated') {
					callbacks.onFinish?.();
					return;
				}

				callbacks.onError?.(err instanceof Error ? err : new Error(message));
			}
		},
	};
}
