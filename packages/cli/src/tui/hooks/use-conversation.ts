import {createConversationApi, streamConversation, streamConversationApproval} from '../utils/stream.js';
import type {OutputPart} from '../utils/stream.js';
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
	onApprovalRequested?: (approvalId: string, toolCallId: string, toolName: string, input?: Record<string, unknown>) => void;
}

export interface Conversation {
	readonly conversationId: string | null;
	readonly incognito: boolean;
	send(message: string, callbacks: ConversationCallbacks): Promise<void>;
	approve(approved: boolean, toolCallId: string, callbacks: ConversationCallbacks): Promise<void>;
	abort(): void;
	clear(): void;
	resume(id: string): void;
	toggleIncognito(): void;
}

// Tools whose sub-calls should be shown as nested children
const CONTAINER_TOOLS = new Set([
	'gather_context',
	'take_action',
	'agent-take_action',
	'agent-gather_context',
	'agent-think',
]);

// ── Convert Mastra data-tool-agent payload to OutputPart[] ────────────────────

function mastraDataToOutputParts(data: {
	toolCalls?: Array<{toolCallId: string; toolName: string; args: Record<string, unknown>; payload?: {toolCallId: string; toolName: string; args: Record<string, unknown>}}>;
	toolResults?: Array<{toolCallId: string; result?: unknown; payload?: {toolCallId: string; result?: unknown}}>;
	steps?: unknown[];
	text?: string;
}): OutputPart[] {
	const parts: OutputPart[] = [];

	// Use latest step's data if available, otherwise top-level
	const steps = Array.isArray(data.steps) ? (data.steps as typeof data[]) : [];
	const source: typeof data = steps.length > 0 ? (steps[steps.length - 1] as typeof data) : data;

	// Merge calls from latest step + top-level
	const stepCalls = source.toolCalls ?? [];
	const topCalls = steps.length > 0 ? (data.toolCalls ?? []) : [];
	const stepCallIds = new Set(stepCalls.map(tc => ((tc as any).payload ?? tc).toolCallId as string));
	const mergedCalls = [
		...stepCalls,
		...topCalls.filter(tc => !stepCallIds.has(((tc as any).payload ?? tc).toolCallId as string)),
	];

	// Merge results from latest step + top-level
	const stepResults = source.toolResults ?? [];
	const topResults = steps.length > 0 ? (data.toolResults ?? []) : [];
	const stepResultIds = new Set(stepResults.map(r => ((r as any).payload ?? r).toolCallId as string));
	const allResults = [
		...stepResults,
		...topResults.filter(r => !stepResultIds.has(((r as any).payload ?? r).toolCallId as string)),
	];

	const resultMap = new Map<string, unknown>();
	for (const r of allResults) {
		const res = (r as any).payload ?? r;
		resultMap.set(res.toolCallId as string, res.result);
	}

	const seenCallIds = new Set<string>();
	for (const tc of mergedCalls) {
		const call = (tc as any).payload ?? tc;
		if (seenCallIds.has(call.toolCallId as string)) continue;
		seenCallIds.add(call.toolCallId as string);

		const hasResult = resultMap.has(call.toolCallId as string);
		const part: OutputPart = {
			type: `tool-${call.toolName as string}`,
			toolCallId: call.toolCallId as string,
			input: call.args as Record<string, unknown>,
			state: hasResult ? 'output-available' : 'in-progress',
			...(hasResult && {output: resultMap.get(call.toolCallId as string)}),
		};
		parts.push(part);
	}

	const text = source.text ?? data.text;
	if (text) {
		parts.push({type: 'text', text, state: 'done' as OutputPart['state']});
	}

	return parts;
}

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
		const toolInputMap = new Map<string, Record<string, unknown>>(); // toolCallId → input
		let activeParent: {id: string; item: ToolCallItem} | null = null;
		let lastAgentItem: ToolCallItem | null = null; // last agent-* tool for data-tool-agent merging
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
							if (event.toolName.startsWith('agent-')) lastAgentItem = item;
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

					case 'tool-input-available': {
						toolInputMap.set(event.toolCallId, event.input);
						break;
					}

					case 'tool-call': {
						toolNameMap.set(event.toolCallId, event.toolName);
						toolInputMap.set(event.toolCallId, event.args);
						const item = new ToolCallItem(event.toolName);
						item.setArgs(event.args);
						activeTools.set(event.toolCallId, item);

						if (CONTAINER_TOOLS.has(event.toolName)) {
							activeParent = {id: event.toolCallId, item};
							if (event.toolName.startsWith('agent-')) lastAgentItem = item;
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
						if (parentItem && event.output) {
							let parts: OutputPart[] | null = null;
							if (Array.isArray(event.output.parts)) {
								parts = event.output.parts as OutputPart[];
							} else if (event.output.toolCalls ?? event.output.toolResults ?? event.output.steps) {
								parts = mastraDataToOutputParts(event.output as Parameters<typeof mastraDataToOutputParts>[0]);
							}
							if (parts) parentItem.updateFromOutputParts(parts);
						}

						if (!event.preliminary && activeParent?.id === event.toolCallId) {
							parentItem?.setDone();
							activeParent = null;
							if (lastAgentItem === parentItem) lastAgentItem = null;
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

						// Mirror webapp's findPendingApprovals: expand container tools into
						// their pending children so the user sees the actual leaf tools.
						const containerItem = activeTools.get(event.toolCallId);
						const isContainerTool =
							toolName === 'agent-take_action' || toolName === 'take_action';

						if (isContainerTool && containerItem) {
							const pendingChildren = containerItem.getPendingChildren();
							if (pendingChildren.length > 0) {
								for (const child of pendingChildren) {
									callbacks.onApprovalRequested?.(
										event.approvalId,
										event.toolCallId,
										child.toolName,
										child.input,
									);
								}
								break;
							}
						}

						// Fall back to the container itself
						const toolInput = toolInputMap.get(event.toolCallId);
						callbacks.onApprovalRequested?.(event.approvalId, event.toolCallId, toolName, toolInput);
						break;
					}

					case 'data-tool-agent': {
						if (lastAgentItem && event.data) {
							const parts = mastraDataToOutputParts(event.data);
							if (parts.length > 0) {
								lastAgentItem.updateFromOutputParts(parts);
								callbacks.onRerender?.();
							}
						}
						break;
					}

					case 'finish-step': {
						for (const item of activeTools.values()) {
							item.setDone();
						}

						activeParent = null;
						lastAgentItem = null;
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

		async approve(approved: boolean, toolCallId: string, callbacks: ConversationCallbacks) {
			if (!conversationId) return;

			const controller = new AbortController();
			activeAbortController = controller;

			await processStream(
				streamConversationApproval(baseUrl, apiKey, conversationId, toolCallId, approved, controller.signal),
				callbacks,
				controller,
			);
		},
	};
}
