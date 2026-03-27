import {createConversationApi, streamConversation, streamConversationApproval} from '../utils/stream.js';
import {ToolCallItem} from '../components/tool-call-item.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConversationCallbacks {
	onTextDelta: (delta: string) => void;
	onToolStart?: (id: string, name: string, item: ToolCallItem) => void;
	onRerender?: () => void;
	onStepFinish?: () => void;
	onFinish?: () => void;
	onAbort?: () => void;
	onError?: (err: Error) => void;
	onApprovalRequested?: (approvalId: string, toolCallId: string, toolName: string) => void;
}

export interface Conversation {
	readonly conversationId: string | null;
	readonly incognito: boolean;
	send(message: string, callbacks: ConversationCallbacks): Promise<void>;
	approve(approved: boolean, callbacks: ConversationCallbacks): Promise<void>;
	abort(): void;
	clear(): void;
	resume(id: string): void;
	toggleIncognito(): void;
}

// Tools whose sub-calls should be shown as nested children
const CONTAINER_TOOLS = new Set(['gather_context', 'take_action']);

// ── Factory (hook-like, no React required) ────────────────────────────────────

export function createConversation(
	baseUrl: string,
	apiKey: string,
): Conversation {
	let conversationId: string | null = null;
	let incognito = false;
	let activeAbortController: AbortController | null = null;

	// ── Shared stream event processor ─────────────────────────────────────────
	async function processStream(
		gen: AsyncGenerator<import('../utils/stream.js').StreamEvent>,
		callbacks: ConversationCallbacks,
		controller: AbortController,
	): Promise<void> {
		const activeTools = new Map<string, ToolCallItem>();
		const toolNameMap = new Map<string, string>(); // toolCallId → toolName
		let activeParent: {id: string; item: ToolCallItem} | null = null;
		let hadApprovalRequest = false;

		try {
			for await (const event of gen) {
				switch (event.type) {
					case 'text-delta': {
						callbacks.onTextDelta(event.delta);
						break;
					}

					case 'tool-input-start': {
						toolNameMap.set(event.toolCallId, event.toolName);
						const item = new ToolCallItem(event.toolName);
						activeTools.set(event.toolCallId, item);

						if (CONTAINER_TOOLS.has(event.toolName)) {
							activeParent = {id: event.toolCallId, item};
							callbacks.onToolStart?.(event.toolCallId, event.toolName, item);
						} else if (activeParent) {
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
						toolNameMap.set(event.toolCallId, event.toolName);
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
						const parentItem = activeTools.get(event.toolCallId);
						if (parentItem && event.output?.parts) {
							parentItem.updateFromOutputParts(event.output.parts);
						}

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

					case 'tool-approval-request': {
						hadApprovalRequest = true;
						const toolName = toolNameMap.get(event.toolCallId) ?? event.toolCallId;
						callbacks.onApprovalRequested?.(event.approvalId, event.toolCallId, toolName);
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
						if (event.error === 'terminated') break;
						callbacks.onError?.(new Error(event.error));
						break;
					}

					default:
						break;
				}
			}

			// Only fire finish if this wasn't an approval pause
			if (!hadApprovalRequest) {
				callbacks.onFinish?.();
			}
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				callbacks.onAbort?.();
				return;
			}

			const msg = err instanceof Error ? err.message : String(err);
			if (msg === 'terminated') {
				if (!hadApprovalRequest) callbacks.onFinish?.();
				return;
			}

			callbacks.onError?.(err instanceof Error ? err : new Error(msg));
		} finally {
			if (activeAbortController === controller) {
				activeAbortController = null;
			}
		}
	}

	return {
		get conversationId() {
			return conversationId;
		},

		get incognito() {
			return incognito;
		},

		abort() {
			activeAbortController?.abort();
			activeAbortController = null;
		},

		clear() {
			conversationId = null;
		},

		resume(id: string) {
			conversationId = id;
		},

		toggleIncognito() {
			incognito = !incognito;
		},

		async send(message: string, callbacks: ConversationCallbacks) {
			const controller = new AbortController();
			activeAbortController = controller;

			if (!conversationId) {
				try {
					conversationId = await createConversationApi(
						baseUrl,
						apiKey,
						message,
						incognito,
					);
				} catch (err) {
					callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
					return;
				}
			}

			await processStream(
				streamConversation(baseUrl, apiKey, conversationId, message, controller.signal),
				callbacks,
				controller,
			);
		},

		async approve(approved: boolean, callbacks: ConversationCallbacks) {
			if (!conversationId) return;

			const controller = new AbortController();
			activeAbortController = controller;

			await processStream(
				streamConversationApproval(baseUrl, apiKey, conversationId, approved, controller.signal),
				callbacks,
				controller,
			);
		},
	};
}
