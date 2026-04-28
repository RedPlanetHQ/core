import {appendFileSync} from 'node:fs';
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

let streamCounter = 0;

export function createConversation(
	baseUrl: string,
	apiKey: string,
): Conversation {
	let conversationId: string | null = null;
	let incognito = false;
	let activeAbortController: AbortController | null = null;
	// Equivalent of webapp's cachedNestedPartsRef — persists agent item across streams
	let savedAgentItem: ToolCallItem | null = null;
	// Persistent useChat-like parts model: survives stream resumptions (e.g. when
	// a paused-for-approval stream ends and a fresh approval stream starts, the
	// new stream may only carry tool-approval-request events without the original
	// tool-input-start that established the toolName). The webapp doesn't lose
	// this because its UIMessage parts persist across stream sessions; the TUI's
	// per-stream maps reset. Mirror the persistence here.
	interface ToolPart {
		toolName: string;
		input?: Record<string, unknown>;
		state?: string; // 'input-streaming' | 'in-progress' | 'output-available' | 'output-denied' | 'output-error' | 'approval-requested' | 'approval-responded'
		parentCallId?: string;
	}
	const partsByCallId = new Map<string, ToolPart>();
	function rememberPart(
		toolCallId: string,
		updates: {toolName?: string; input?: Record<string, unknown>; state?: string; parentCallId?: string},
	): void {
		const existing = partsByCallId.get(toolCallId);
		partsByCallId.set(toolCallId, {
			toolName: updates.toolName || existing?.toolName || toolCallId,
			input: updates.input ?? existing?.input,
			state: updates.state ?? existing?.state,
			parentCallId: updates.parentCallId ?? existing?.parentCallId,
		});
	}
	const TERMINAL_STATES = new Set(['output-available', 'output-denied', 'output-error', 'approval-responded']);
	function findPendingChildrenOf(parentCallId: string): Array<{toolName: string; input: Record<string, unknown>; toolCallId: string}> {
		const out: Array<{toolName: string; input: Record<string, unknown>; toolCallId: string}> = [];
		for (const [callId, part] of partsByCallId) {
			if (part.parentCallId === parentCallId && (!part.state || !TERMINAL_STATES.has(part.state))) {
				out.push({toolName: part.toolName, input: part.input ?? {}, toolCallId: callId});
			}
		}
		return out;
	}

	// ── Shared stream event processor ─────────────────────────────────────────
	async function processStream(
		gen: AsyncGenerator<import('../utils/stream.js').StreamEvent>,
		callbacks: ConversationCallbacks,
		controller: AbortController,
	): Promise<void> {
		const streamNum = ++streamCounter;
		const logFile = `/tmp/core-stream-${streamNum}.log`;
		const activeTools = new Map<string, ToolCallItem>();
		const toolNameMap = new Map<string, string>(); // toolCallId → toolName
		const toolInputMap = new Map<string, Record<string, unknown>>(); // toolCallId → input
		let activeParent: {id: string; item: ToolCallItem} | null = null;
		let lastAgentItem: ToolCallItem | null = savedAgentItem; // restored from prior stream (like cachedNestedPartsRef)
		let lastAgentCallId: string | null = null; // tracks lastAgentItem's toolCallId for parent linkage
		let hadApprovalRequest = false;
		const approvedContainerIds = new Set<string>(); // prevent duplicate approval expansion

			try {
			for await (const event of gen) {
				try { appendFileSync(logFile, JSON.stringify(event) + '\n'); } catch { /* ignore */ }
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
							if (event.toolName.startsWith('agent-')) {
								lastAgentItem = item;
								lastAgentCallId = event.toolCallId;
							}
							rememberPart(event.toolCallId, {toolName: event.toolName, state: 'input-streaming'});
							callbacks.onToolStart?.(event.toolCallId, event.toolName, item);
						} else if (activeParent) {
							activeParent.item.addChild(item);
							rememberPart(event.toolCallId, {toolName: event.toolName, state: 'input-streaming', parentCallId: activeParent.id});
							callbacks.onRerender?.();
						} else {
							rememberPart(event.toolCallId, {toolName: event.toolName, state: 'input-streaming'});
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
						rememberPart(event.toolCallId, {input: event.input, state: 'in-progress'});
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
							if (event.toolName.startsWith('agent-')) {
								lastAgentItem = item;
								lastAgentCallId = event.toolCallId;
							}
							rememberPart(event.toolCallId, {toolName: event.toolName, input: event.args, state: 'in-progress'});
							callbacks.onToolStart?.(event.toolCallId, event.toolName, item);
						} else if (activeParent) {
							item.setDone();
							activeParent.item.addChild(item);
							rememberPart(event.toolCallId, {toolName: event.toolName, input: event.args, state: 'in-progress', parentCallId: activeParent.id});
							callbacks.onRerender?.();
						} else {
							rememberPart(event.toolCallId, {toolName: event.toolName, input: event.args, state: 'in-progress'});
							callbacks.onToolStart?.(event.toolCallId, event.toolName, item);
						}

						break;
					}

					case 'tool-output-available': {
						rememberPart(event.toolCallId, {state: 'output-available'});
						const parentItem = activeTools.get(event.toolCallId);
						if (parentItem && event.output) {
							let parts: OutputPart[] | null = null;
							if (Array.isArray(event.output.parts)) {
								parts = event.output.parts as OutputPart[];
							} else if (event.output.toolCalls ?? event.output.toolResults ?? event.output.steps) {
								parts = mastraDataToOutputParts(event.output as Parameters<typeof mastraDataToOutputParts>[0]);
							}
							if (parts) {
								parentItem.updateFromOutputParts(parts);
								// Mirror the nested children into the persistent parts model so
								// approval expansion can find them when the container's
								// ToolCallItem isn't in activeTools (cross-stream resumption).
								for (const part of parts) {
									if (!part.type.startsWith('tool-') || !part.toolCallId) continue;
									const childToolName = part.type.slice('tool-'.length);
									const isTerminal =
										part.state === 'output-available' ||
										part.state === 'output-denied' ||
										part.state === 'output-error';
									rememberPart(part.toolCallId, {
										toolName: childToolName,
										input: part.input,
										parentCallId: event.toolCallId,
										state: isTerminal ? 'output-available' : (part.state ?? 'in-progress'),
									});
								}
							}
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
						rememberPart(event.toolCallId, {state: 'output-available'});
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
						// Mark the approval-requested state on the persistent part.
						rememberPart(event.toolCallId, {state: 'approval-requested'});

						// Resolve toolName from the persistent parts model first, then
						// fall back to the per-stream toolNameMap. This catches the case
						// where the approval arrives in a fresh stream session that didn't
						// see the original tool-input-start.
						const persistedPart = partsByCallId.get(event.toolCallId);
						const toolName = persistedPart?.toolName ?? toolNameMap.get(event.toolCallId) ?? event.toolCallId;

						// Save agent item unconditionally — must happen before any early break
						// so the next processStream (approval resume stream) can look up children.
						if (lastAgentItem) savedAgentItem = lastAgentItem;

						// Mirror webapp's findPendingApprovals: expand container tools into
						// their pending children so the user sees the actual leaf tools.
						// Find pending children via the persistent parts model (works across
						// stream resumptions, unlike activeTools which is per-stream).
						const isContainerTool =
							toolName === 'agent-take_action' || toolName === 'take_action';

						if (isContainerTool) {
							// Deduplicate: parallel tool calls fire multiple approval events for
							// the same container. Only expand once — one approval covers all children.
							if (approvedContainerIds.has(event.toolCallId)) break;
							approvedContainerIds.add(event.toolCallId);

							// Source 1 (in-stream): the container's ToolCallItem in activeTools
							// has nested children registered via tool-output-available's
							// updateFromOutputParts. This is the most reliable source when the
							// container was started in this same stream.
							const containerItem = activeTools.get(event.toolCallId);
							let pendingChildren: Array<{toolCallId: string; toolName: string; input: Record<string, unknown>}> = containerItem?.getPendingChildren() ?? [];

							// Source 2 (cross-stream resumption): the persistent parts model.
							// The container's ToolCallItem may have been cleared but
							// partsByCallId entries with parentCallId === containerId persist.
							if (pendingChildren.length === 0) {
								pendingChildren = findPendingChildrenOf(event.toolCallId);
							}

							if (pendingChildren.length > 0) {
								for (const child of pendingChildren) {
									// Pass child's own toolCallId — sharing the container's id
									// across children would collapse decisions in the panel
									// (decisions Map keyed by toolCallId).
									callbacks.onApprovalRequested?.(
										event.approvalId,
										child.toolCallId,
										child.toolName,
										child.input,
									);
								}
								break;
							}
						}

						// Fall back: single approval. resolvedName comes from persistedPart.
						const toolInput = persistedPart?.input ?? toolInputMap.get(event.toolCallId);
						callbacks.onApprovalRequested?.(event.approvalId, event.toolCallId, toolName, toolInput);
						break;
					}

					case 'data-tool-agent': {
						// Mirror webapp's mergeAgentParts: agentData = raw.data ?? raw
						const agentData = (event as any).data ?? event;
						if (agentData.toolCalls || agentData.toolResults || agentData.steps) {
							// Orphan in resumed approval stream — create synthetic item like webapp
							if (!lastAgentItem) {
								lastAgentItem = new ToolCallItem('agent-take_action');
							}
							const allAgentCalls = [
								...(agentData.toolCalls ?? []),
								...(Array.isArray(agentData.steps)
									? agentData.steps.flatMap((s: any) => s.toolCalls ?? [])
									: []),
							];
							for (const tc of allAgentCalls) {
								const call = (tc as any).payload ?? tc;
								if (call.toolCallId && call.toolName) {
									toolNameMap.set(call.toolCallId as string, call.toolName as string);
									if (call.args) toolInputMap.set(call.toolCallId as string, call.args as Record<string, unknown>);
									// Children registered via data-tool-agent are nested inside the
									// active agent container — link them so approval expansion can find them.
									rememberPart(call.toolCallId as string, {
										toolName: call.toolName as string,
										input: call.args as Record<string, unknown> | undefined,
										parentCallId: lastAgentCallId ?? undefined,
										state: 'in-progress',
									});
								}
							}
							// Mark any toolResults as output-available in the parts model so
							// findPendingChildrenOf doesn't return completed tools as "pending".
							const allResults = [
								...(agentData.toolResults ?? []),
								...(Array.isArray(agentData.steps)
									? agentData.steps.flatMap((s: any) => s.toolResults ?? [])
									: []),
							];
							for (const r of allResults) {
								const res = (r as any).payload ?? r;
								if (res.toolCallId) {
									rememberPart(res.toolCallId as string, {state: 'output-available'});
								}
							}
							const parts = mastraDataToOutputParts(agentData);
							if (parts.length > 0) {
								lastAgentItem.updateFromOutputParts(parts);
								callbacks.onRerender?.();
							} else if (allResults.length > 0) {
								// Post-approval pattern: toolCalls is [] but toolResults has results
								// for children registered in an earlier snapshot — mark them done.
								const resultMap = new Map<string, unknown>();
								for (const r of allResults) {
									const res = (r as any).payload ?? r;
									if (res.toolCallId) resultMap.set(res.toolCallId as string, res.result);
								}
								lastAgentItem.markChildrenDoneByIds(resultMap);
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
			savedAgentItem = null;
			partsByCallId.clear();
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
