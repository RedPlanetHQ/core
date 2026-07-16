import {
	TUI,
	Text,
	Editor,
	ProcessTerminal,
	Markdown,
	Loader,
	Spacer,
	Container,
	CombinedAutocompleteProvider,
	matchesKey,
	Key,
} from '@earendil-works/pi-tui';
import type {Component} from '@earendil-works/pi-tui';
import {buildAvatar} from './utils/avatar.js';
import chalk from 'chalk';
import {StatusLine, type StatusZone} from './components/status-line.js';
import {editorTheme, markdownTheme} from './themes.js';
import {createConversation} from './hooks/use-conversation.js';
import {ToolCallItem} from './components/tool-call-item.js';
import {ConversationSelector} from './components/conversation-selector.js';
import {TaskList} from './components/task-list.js';
import {TaskDetail} from './components/task-detail.js';
import type {TaskSummary} from './utils/stream.js';
import {IntegrationsView} from './components/integrations-view.js';
import {WidgetsView} from './components/widgets-view.js';
import {loadWidgetBundle} from './utils/widget-loader.js';
import {getPreferences} from '../config/preferences.js';
import {fetchConversationHistory, fetchWorkspace, fetchIntegrationAccounts, openBrowser, createTaskApi, isRecurringTask, summariseCatchup, fetchCredits, NoCreditsError, type CreditsInfo} from './utils/stream.js';
import type {HistoryMessage} from './utils/stream.js';
import {getToolDisplayName} from './utils/tool-names.js';
import {ApprovalPanel} from './components/approval-panel.js';
import {ContextBar, type ContextInfo} from './components/context-bar.js';
import {SplitPane} from './components/split-pane.js';
import {ScratchpadPanel} from './components/scratchpad-panel.js';
import {TaskRuns} from './components/task-runs.js';

export function startTuiApp(
	baseUrl: string,
	apiKey: string,
	version: string,
): void {
	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);

	// ── Header ───────────────────────────────────────────────────────────────
	// Avatar placeholder (replaced with real image once fetched)
	const avatarContainer = new Container();
	tui.addChild(avatarContainer);

	const infoText = new Text(
		chalk.bold.white('CORE') + '  ' + chalk.dim('v' + version) + '\n' + chalk.gray('ctrl+c to exit'),
		1,
		0,
	);
	tui.addChild(infoText);
	tui.addChild(new Spacer(1));

	// ── Messages area ─────────────────────────────────────────────────────────
	const messagesContainer = new Container();
	// SplitPane wraps messages so we can slot a scratchpad panel on the left
	// half when `/today` is active. Without a left child it renders the right
	// child at full width, i.e. behaves exactly like the plain container.
	const messagesSplit = new SplitPane(messagesContainer);
	tui.addChild(messagesSplit);

	// ── Context bar (shown above editor when a task/scratchpad is active) ────
	const contextBar = new ContextBar();
	tui.addChild(contextBar);

	// ── Editor ────────────────────────────────────────────────────────────────
	const editor = new Editor(tui, editorTheme);
	editor.setAutocompleteProvider(
		new CombinedAutocompleteProvider(
			[
				{name: 'new-task', description: 'Create a new task from the next message'},
				{name: 'today', description: 'Open today’s scratchpad'},
				{name: 'catchup', description: 'Summarise unread inbox items'},
				{name: 'clear', description: 'Clear conversation and start fresh'},
				{name: 'resume', description: 'Resume a previous conversation'},
				{name: 'tasks', description: 'View and manage your tasks'},
				{name: 'integrations', description: 'View and connect integrations'},
				{name: 'widgets', description: 'Configure widgets (below-input & overview)'},
				{
					name: 'incognito',
					description: 'Toggle incognito mode (new conversations only)',
				},
				{name: 'exit', description: 'Exit CORE'},
			],
			process.cwd(),
		),
	);
	tui.addChild(editor);

	// ── Status line — badges + tasks + widget + G + C (focusable, 2 rows)
	const statusLine = new StatusLine(baseUrl, apiKey, () => tui.requestRender());
	statusLine.onBlur = () => {
		tui.setFocus(editor);
		tui.requestRender();
	};
	statusLine.onActivate = (zone: StatusZone) => {
		tui.setFocus(editor);
		if (zone === 'tasks') {
			showTaskList();
		} else if (zone === 'catchup') {
			runCatchup();
		} else if (zone === 'gateways') {
			addToMessages(
				new Text(
					chalk.dim('Manage gateways: run ') +
						chalk.white('corebrain gateway list') +
						chalk.dim(' outside the chat.'),
					1,
					0,
				),
			);
			addToMessages(new Spacer(1));
			tui.requestRender();
		}
	};
	tui.addChild(statusLine);

	async function loadBelowInputWidget(): Promise<void> {
		statusLine.setWidget(null);

		const prefs = getPreferences();
		const cfg = prefs.widgets?.belowInput;
		if (!cfg) {
			tui.requestRender();
			return;
		}

		try {
			const mod = await loadWidgetBundle(cfg.frontendUrl);
			const bundleWidgets = (mod.widgets ?? []) as Array<{
				slug: string;
				render: (ctx: unknown) => Promise<unknown>;
			}>;
			const widget = bundleWidgets.find(w => w.slug === cfg.widgetSlug);
			if (!widget) return;

			const ctx = {
				placement: 'tui' as const,
				pat: apiKey,
				accounts: [{id: cfg.accountId, slug: cfg.accountSlug, name: cfg.accountName}],
				baseUrl,
				requestRender: () => tui.requestRender(),
			};
			const component = (await widget.render(ctx)) as Component;
			if (component && typeof component.render === 'function') {
				statusLine.setWidget(component);
				tui.requestRender();
			}
		} catch {
			// silent — widget errors shouldn't crash the chat
		}
	}

	tui.setFocus(editor);

	// ── State ─────────────────────────────────────────────────────────────────
	// accountId → frontendUrl map for toolUI loading
	const accountFrontendMap = new Map<string, string>();

	let overlayActive = false;
	let newTaskMode = false;
	let lastTabAt: number | null = null;
	const TAB_DOUBLE_TAP_MS = 300;

	function setNewTaskMode(on: boolean): void {
		if (newTaskMode === on) return;
		newTaskMode = on;
		statusLine.setMode(on ? 'newTask' : 'chat');
		tui.requestRender();
	}

	let isProcessing = false;
	let allToolItems: ToolCallItem[] = [];
	let conversationComponents: Component[] = [];
	let requestId = 0;
	let butlerName = 'CORE'; // replaced once workspace loads
	let workspaceAccent = '#c15e50';
	let pendingApprovalPanel: ApprovalPanel | null = null;
	let autoApproveAll = false;
	// Tracks whether the "Thinking…" loader is currently mounted under
	// `messagesContainer`. Hoisted here (before insertBeforeLoader) so the
	// helper can read it — `let` bindings aren't hoisted, unlike function
	// decls, so a lower declaration would trip TDZ at runtime.
	let loaderVisible = false;
	let currentTask: TaskSummary | null = null;
	let taskInfoOverlay: TaskDetail | null = null;
	// Pending catchup summary that will seed a new chat when the user presses `c`.
	let pendingCatchupSummary: string | null = null;
	// Container holding the catchup summary + hints while catchup view is active.
	let catchupViewContainer: Container | null = null;
	// Active scratchpad side-panel (set while `/today` is in effect).
	let scratchpadPanel: ScratchpadPanel | null = null;
	// Cached credit balance for the workspace. `null` = not fetched yet.
	// The webapp's `/api/v1/conversation` and `/api/v1/conversation/create`
	// endpoints both server-gate the same check; we mirror it client-side so
	// the input border can turn red immediately instead of waiting for the
	// user to type + submit and see a 402.
	let creditsInfo: CreditsInfo | null = null;
	// Which context is driving the "normal" border colour right now. Kept
	// separate from `contextBar.getContext()` because scratchpad mode hides
	// the bar visually but still wants a yellow border.
	let activeBorderKind: 'task' | 'scratchpad' | null = null;
	function outOfCredits(): boolean {
		if (!creditsInfo) return false;
		if (!creditsInfo.billingEnabled) return false;
		if (creditsInfo.byok) return false;
		return creditsInfo.available <= 0;
	}
	function refreshBorder(): void {
		editor.borderColor = outOfCredits()
			? chalk.red
			: ContextBar.borderColor(activeBorderKind);
		tui.requestRender();
	}
	async function refreshCredits(): Promise<void> {
		const info = await fetchCredits(baseUrl, apiKey);
		if (info) {
			creditsInfo = info;
			refreshBorder();
		}
	}

	const conversation = createConversation(baseUrl, apiKey);

	let avatarComponent: Component = buildAvatar(butlerName, workspaceAccent);
	avatarContainer.addChild(avatarComponent);

	fetchWorkspace(baseUrl, apiKey)
		.then(ws => {
			if (ws?.name) {
				butlerName = ws.name;
				infoText.setText(
					chalk.bold.white(ws.name) + '  ' + chalk.dim('v' + version) + '\n' + chalk.gray('ctrl+c to exit'),
				);
				avatarContainer.removeChild(avatarComponent);
				avatarComponent = buildAvatar(butlerName, workspaceAccent);
				avatarContainer.addChild(avatarComponent);
				tui.requestRender();
			}
		})
		.catch(() => {});

	fetchIntegrationAccounts(baseUrl, apiKey)
		.then(accounts => {
			for (const acc of accounts) {
				const url = acc.integrationDefinition.frontendUrl;
				if (url) accountFrontendMap.set(acc.id, url);
			}
		})
		.catch(() => {});

	// Initial credit probe + 60s poll so a top-up done in the webapp reflects
	// back in the CLI within a minute (mirrors the webapp's polling cadence).
	refreshCredits().catch(() => {});
	setInterval(() => {
		refreshCredits().catch(() => {});
	}, 60_000);

	const loader = new Loader(
		tui,
		s => chalk.cyan(s),
		s => chalk.gray(s),
		'Thinking...',
	);

	// ── Helpers ───────────────────────────────────────────────────────────────

	function addToMessages(component: Component): void {
		conversationComponents.push(component);
		messagesContainer.addChild(component);
	}

	function insertBeforeLoader(component: Component): void {
		conversationComponents.push(component);
		// Insert new content ABOVE the loader when it's visible, otherwise
		// just append. Do NOT re-add the loader here — that used to bypass
		// the loaderVisible flag and stranded the loader in the tree after
		// removeLoader() had already run, which the caller couldn't clear.
		const loaderInTree = loaderVisible;
		if (loaderInTree) {
			try {
				messagesContainer.removeChild(loader);
			} catch {
				// ignore
			}
		}
		messagesContainer.addChild(component);
		if (loaderInTree) {
			messagesContainer.addChild(loader);
		}
	}

	function toggleIncognito(): void {
		if (conversation.conversationId !== null) {
			addToMessages(
				new Text(
					chalk.yellow(
						'Incognito can only be toggled before the first message.',
					),
					1,
					0,
				),
			);
			tui.requestRender();
			return;
		}

		conversation.toggleIncognito();
		statusLine.setIncognito(conversation.incognito);
		tui.requestRender();
	}

	function applyContext(info: ContextInfo | null): void {
		contextBar.setContext(info);
		activeBorderKind = info?.kind ?? null;
		refreshBorder();
	}

	function setTaskContext(task: TaskSummary | null): void {
		currentTask = task;
		if (!task) {
			applyContext(null);
			return;
		}
		const pill = task.displayId ?? 'TASK';
		const hint = isRecurringTask(task)
			? 'ctrl+o info · ctrl+r runs'
			: 'ctrl+o info';
		applyContext({
			kind: 'task',
			pill,
			subtitle: `${task.title || 'Untitled'}  (${task.status})`,
			hint,
		});
	}

	function clearConversation(): void {
		requestId++; // invalidate any in-flight callbacks

		try {
			messagesContainer.removeChild(loader);
			loader.stop();
		} catch {
			// not in tree
		}

		for (const child of conversationComponents) {
			try {
				messagesContainer.removeChild(child);
			} catch {
				// already removed
			}
		}

		conversationComponents = [];
		allToolItems = [];
		pendingApprovalPanel = null;
		autoApproveAll = false;
		statusLine.setAcceptAll(false);
		conversation.clear();
		isProcessing = false;
		editor.disableSubmit = false;
		setTaskContext(null);
		tui.requestRender();
	}

	// ── Submit ────────────────────────────────────────────────────────────────

	editor.onSubmit = (message: string) => {
		const trimmed = message.trim();

		// Task mode: empty submit cancels mode; non-empty creates a task.
		if (newTaskMode) {
			if (!trimmed) {
				setNewTaskMode(false);
				return;
			}
			createTaskApi(baseUrl, apiKey, {title: trimmed})
				.then(task => {
					addToMessages(
						new Text(
							chalk.green('✓ Task created: ') +
								chalk.white(task.title) +
								chalk.dim(task.displayId ? `  [${task.displayId}]` : ''),
							1,
							0,
						),
					);
					addToMessages(new Spacer(1));
					tui.requestRender();
				})
				.catch((err: Error) => {
					addToMessages(
						new Text(
							chalk.red('Failed to create task: ') + chalk.dim(err.message),
							1,
							0,
						),
					);
					tui.requestRender();
				})
				.finally(() => {
					setNewTaskMode(false);
				});
			return;
		}

		if (trimmed === '/clear') {
			clearConversation();
			return;
		}

		if (trimmed === '/resume') {
			showResumeSelector();
			return;
		}

		if (trimmed === '/tasks') {
			showTaskList();
			return;
		}

		if (trimmed === '/integrations') {
			showIntegrationsView();
			return;
		}

		if (trimmed === '/widgets') {
			showWidgetsView();
			return;
		}

		if (trimmed === '/new-task') {
			setNewTaskMode(true);
			return;
		}

		if (trimmed === '/catchup') {
			runCatchup();
			return;
		}

		if (trimmed === '/today') {
			openScratchpad();
			return;
		}

		if (trimmed === '/incognito') {
			toggleIncognito();
			return;
		}

		if (trimmed === '/exit') {
			statusLine.dispose();
			tui.stop();
			process.stdout.write('\n');
			process.exit(0);
		}

		if (isProcessing || !trimmed) return;
		runMessage(trimmed);
	};

	function hideMainUI(): void {
		if (statusLine.focused) tui.setFocus(editor);
		try { tui.removeChild(statusLine); } catch { /* ignore */ }
		tui.removeChild(messagesSplit);
		try { tui.removeChild(contextBar); } catch { /* ignore */ }
		tui.removeChild(editor);
		overlayActive = true;
	}

	function restoreMainUI(): void {
		overlayActive = false;
		tui.addChild(messagesSplit);
		tui.addChild(contextBar);
		tui.addChild(editor);
		tui.addChild(statusLine);
		tui.setFocus(editor);
		tui.requestRender();
	}


	function renderHistoryMessage(msg: HistoryMessage): boolean {
		let any = false;

		for (const part of msg.parts) {
			const t = part.type;

			// ── text ──────────────────────────────────────────────────────────
			if (t === 'text' && part.text) {
				if (msg.role === 'user') {
					addToMessages(
						new Text(
							chalk.bgHex('#3a3a3a').white(' ❯ ' + part.text + ' '),
							0,
							0,
						),
					);
				} else {
					addToMessages(new Markdown(part.text, 1, 0, markdownTheme));
				}
				any = true;
				continue;
			}

			// ── file (image or other) ─────────────────────────────────────────
			if (t === 'file') {
				const filename = part.filename ?? 'attachment';
				const isImage =
					typeof part.mediaType === 'string' &&
					part.mediaType.startsWith('image/');
				const label = isImage
					? `[image: ${filename}]`
					: `[file: ${filename}${part.mediaType ? ' (' + part.mediaType + ')' : ''}]`;
				addToMessages(new Text(chalk.dim(label), 1, 0));
				any = true;
				continue;
			}

			// ── tool-<name> ───────────────────────────────────────────────────
			if (t.startsWith('tool-')) {
				const toolName = t.slice('tool-'.length);
				// Skip data-tool-agent (its info is in parent tool's output) and
				// step-start sentinels.
				if (
					toolName === 'agent' ||
					toolName === 'agent-take_action' ||
					toolName === 'take_action'
				) {
					// Render parent agent/take_action wrappers as a compact line if no
					// other tool parts will represent the work. For history rendering
					// we defer to the nested tools that should accompany them; if those
					// don't exist (rare), still print a marker.
				}

				const displayName = getToolDisplayName(toolName);
				const argSummary = summarizeArgs(part.input);
				const dot =
					part.state === 'output-denied'
						? chalk.red('✗')
						: part.state === 'output-error'
							? chalk.red('!')
							: chalk.green('●');
				const header = `${dot} ${chalk.bold(displayName)}${argSummary ? chalk.dim(' (' + argSummary + ')') : ''}`;
				addToMessages(new Text(header, 1, 0));

				// Result preview — up to 2 non-empty lines, HTML stripped, prefixed
				// with `│` / `└─` to match the streaming ToolCallItem style.
				const resultStr = stringifyToolOutput(part.output);
				if (resultStr) {
					const allLines = resultStr
						.split('\n')
						.map(cleanPreviewLine)
						.filter(l => l.length > 0);
					const previewLines = allLines.slice(0, 2);
					const extra = allLines.length - previewLines.length;
					previewLines.forEach((line, idx) => {
						const isLast = idx === previewLines.length - 1 && extra === 0;
						const prefix = isLast ? '  └ ' : '  │ ';
						addToMessages(new Text(chalk.dim(prefix + line), 1, 0));
					});
					if (extra > 0) {
						addToMessages(
							new Text(chalk.dim(`  └ +${extra} more lines`), 1, 0),
						);
					}
				}

				// Breathing room so consecutive tool calls don't run together.
				addToMessages(new Spacer(1));

				any = true;
				continue;
			}

			// ── data-tool-agent / step-start / unknown ────────────────────────
			// Silently skip — these are streaming-protocol artifacts.
		}

		return any;
	}

	/**
	 * Turn one line of a tool's raw output into something that scans in the
	 * preview strip: HTML tags stripped, whitespace collapsed, capped to a
	 * readable width. Preserves tag *content* so `<p>hello</p>` becomes `hello`
	 * (not empty), which is important for HTML-heavy tools like get_scratchpad.
	 */
	function cleanPreviewLine(raw: string): string {
		const stripped = raw
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'");
		const collapsed = stripped.replace(/\s+/g, ' ').trim();
		if (collapsed.length <= 120) return collapsed;
		return collapsed.slice(0, 120) + '…';
	}

	function summarizeArgs(input: unknown): string {
		if (!input || typeof input !== 'object') return '';
		const obj = input as Record<string, unknown>;
		const firstVal = Object.values(obj)[0];
		if (firstVal === undefined) return '';
		const str =
			typeof firstVal === 'string'
				? firstVal
				: JSON.stringify(firstVal);
		const oneLine = str.replace(/[\r\n\t]+/g, ' ').trim();
		return oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine;
	}

	function stringifyToolOutput(output: unknown): string {
		if (output === undefined || output === null) return '';
		if (typeof output === 'string') return output;
		try {
			return JSON.stringify(output, null, 2);
		} catch {
			return String(output);
		}
	}

	function loadConversationHistoryIntoMessages(conversationId: string): void {
		const historyLoader = new Loader(
			tui,
			s => chalk.cyan(s),
			s => chalk.gray(s),
			'Loading history...',
		);
		messagesContainer.addChild(historyLoader);
		historyLoader.start();
		tui.requestRender();

		fetchConversationHistory(baseUrl, apiKey, conversationId)
			.then(({messages, incognito: convIncognito}) => {
				messagesContainer.removeChild(historyLoader);
				historyLoader.stop();

				if (convIncognito && !conversation.incognito) {
					conversation.toggleIncognito();
					statusLine.setIncognito(true);
				}

				for (const msg of messages) {
					const renderedAny = renderHistoryMessage(msg);
					if (renderedAny) {
						addToMessages(new Spacer(1));
					}
				}

				tui.requestRender();
			})
			.catch((err: Error) => {
				messagesContainer.removeChild(historyLoader);
				historyLoader.stop();
				addToMessages(
					new Text(
						chalk.red('Failed to load history: ') + chalk.gray(err.message),
						1,
						0,
					),
				);
				tui.requestRender();
			});
	}

	function showResumeSelector(): void {
		hideMainUI();

		const selector = new ConversationSelector(baseUrl, apiKey, tui, () =>
			tui.requestRender(),
		);
		tui.addChild(selector);
		tui.setFocus(selector);

		function exitSelector(): void {
			tui.removeChild(selector);
			restoreMainUI();
		}

		selector.onCancel = () => {
			exitSelector();
		};

		selector.onSelect = conv => {
			exitSelector();
			clearConversation();
			conversation.resume(conv.id);
			loadConversationHistoryIntoMessages(conv.id);
		};
	}

	function showTaskList(): void {
		hideMainUI();

		const list = new TaskList(baseUrl, apiKey, tui, () => tui.requestRender());
		tui.addChild(list);
		tui.setFocus(list);

		const exit = (): void => {
			list.dispose();
			try { tui.removeChild(list); } catch { /* ignore */ }
			restoreMainUI();
		};

		list.onCancel = exit;

		list.onOpenTask = (task: TaskSummary) => {
			list.dispose();
			try { tui.removeChild(list); } catch { /* ignore */ }

			const convIds = task.conversationIds ?? [];
			if (convIds.length === 0) {
				showTaskDetail(task);
				return;
			}

			openTaskConversation(task, convIds[convIds.length - 1]);
		};

		list.onCreateTask = () => {
			exit();
			setNewTaskMode(true);
		};
	}

	function openTaskConversation(task: TaskSummary, conversationId: string): void {
		restoreMainUI();
		clearConversation();
		setTaskContext(task);
		conversation.resume(conversationId);
		loadConversationHistoryIntoMessages(conversationId);
	}

	function showTaskDetail(task: TaskSummary): void {
		const detail = new TaskDetail(
			baseUrl,
			apiKey,
			task.id,
			tui,
			() => tui.requestRender(),
		);
		tui.addChild(detail);
		tui.setFocus(detail);

		detail.onCancel = () => {
			try { tui.removeChild(detail); } catch { /* ignore */ }
			showTaskList();
		};
	}

	function showTaskInfoOverlay(task: TaskSummary): void {
		if (taskInfoOverlay) return;
		hideMainUI();

		const detail = new TaskDetail(
			baseUrl,
			apiKey,
			task.id,
			tui,
			() => tui.requestRender(),
		);
		taskInfoOverlay = detail;
		tui.addChild(detail);
		tui.setFocus(detail);

		detail.onCancel = () => {
			try { tui.removeChild(detail); } catch { /* ignore */ }
			taskInfoOverlay = null;
			restoreMainUI();
		};
	}

	function showTaskRunsOverlay(task: TaskSummary): void {
		hideMainUI();

		const runsView = new TaskRuns(
			baseUrl,
			apiKey,
			task,
			tui,
			() => tui.requestRender(),
		);
		tui.addChild(runsView);
		tui.setFocus(runsView);

		runsView.onCancel = () => {
			try { tui.removeChild(runsView); } catch { /* ignore */ }
			restoreMainUI();
		};

		runsView.onOpenRun = run => {
			try { tui.removeChild(runsView); } catch { /* ignore */ }
			// Swap the active conversation to the picked run. `openTaskConversation`
			// already handles clearing state, setting the task context, and
			// loading history — reuse it so the flow matches picking a run from
			// `/tasks`.
			openTaskConversation(task, run.id);
		};
	}

	function showIntegrationsView(): void {
		hideMainUI();

		const view = new IntegrationsView(baseUrl, apiKey, tui, () =>
			tui.requestRender(),
		);
		tui.addChild(view);
		tui.setFocus(view);

		view.onCancel = () => {
			tui.removeChild(view);
			restoreMainUI();
		};
	}

	function showWidgetsView(): void {
		hideMainUI();

		const view = new WidgetsView(baseUrl, apiKey, tui, () =>
			tui.requestRender(),
		);
		tui.addChild(view);
		tui.setFocus(view);

		view.onCancel = () => {
			tui.removeChild(view);
			// Reload below-input widget in case selection changed, then restore UI
			loadBelowInputWidget().then(() => restoreMainUI()).catch(() => restoreMainUI());
		};
	}

	// ── Scratchpad (/today) ───────────────────────────────────────────────────

	function updateScratchpadContextBar(): void {
		if (!scratchpadPanel) {
			// If a task was active, keep its context; otherwise clear.
			if (currentTask) setTaskContext(currentTask);
			else applyContext(null);
			return;
		}
		// The ScratchpadPanel already shows the date + nav hints, so an extra
		// context-bar row is just repetition. Keep the visual bar empty but
		// drive the border colour off `activeBorderKind = 'scratchpad'`.
		contextBar.setContext(null);
		activeBorderKind = 'scratchpad';
		refreshBorder();
	}

	function openScratchpad(): void {
		if (scratchpadPanel) {
			const currentDate = scratchpadPanel.getDate();
			const today = new Date();
			const onToday =
				currentDate.getUTCFullYear() === today.getUTCFullYear() &&
				currentDate.getUTCMonth() === today.getUTCMonth() &&
				currentDate.getUTCDate() === today.getUTCDate();
			if (onToday) {
				// Toggle off — /today acts as a "close scratchpad" too.
				closeScratchpad();
				return;
			}
			scratchpadPanel.setDate(today);
			updateScratchpadContextBar();
			tui.requestRender();
			return;
		}
		scratchpadPanel = new ScratchpadPanel(baseUrl, apiKey, () => tui.requestRender());
		scratchpadPanel.onDateChange = () => updateScratchpadContextBar();
		messagesSplit.setLeft(scratchpadPanel);
		updateScratchpadContextBar();
		tui.requestRender();
	}

	function closeScratchpad(): void {
		if (!scratchpadPanel) return;
		scratchpadPanel = null;
		messagesSplit.setLeft(null);
		updateScratchpadContextBar();
		tui.requestRender();
	}

	// ── Catchup ───────────────────────────────────────────────────────────────

	function showCatchupView(summary: string, count: number): void {
		hideMainUI();
		pendingCatchupSummary = summary;

		const container = new Container();
		catchupViewContainer = container;
		container.addChild(new Spacer(1));
		container.addChild(
			new Text(
				chalk.bold.cyan('Catchup') +
					chalk.dim(` · ${count} item${count === 1 ? '' : 's'}`),
				1,
				0,
			),
		);
		container.addChild(new Spacer(1));
		container.addChild(new Markdown(summary, 1, 0, markdownTheme));
		container.addChild(new Spacer(2));
		container.addChild(
			new Text(
				chalk.bold.white('  c') +
					chalk.dim('  continue in a new chat') +
					chalk.dim('     ') +
					chalk.bold.white('esc') +
					chalk.dim('  close'),
				1,
				0,
			),
		);
		container.addChild(new Spacer(1));
		tui.addChild(container);
		tui.setFocus(container);
		tui.requestRender();
	}

	function closeCatchupView(): void {
		if (!catchupViewContainer) return;
		try { tui.removeChild(catchupViewContainer); } catch { /* ignore */ }
		catchupViewContainer = null;
		pendingCatchupSummary = null;
		restoreMainUI();
	}

	function showCatchupEmptyToast(): void {
		addToMessages(new Text(chalk.dim('Nothing to catch up on.'), 1, 0));
		addToMessages(new Spacer(1));
		tui.requestRender();
	}

	function runCatchup(): void {
		if (isProcessing || catchupViewContainer) return;
		pendingCatchupSummary = null;
		showLoader();
		summariseCatchup(baseUrl, apiKey)
			.then(({summary, count}) => {
				removeLoader();
				if (count === 0 || !summary) {
					showCatchupEmptyToast();
					return;
				}
				showCatchupView(summary, count);
			})
			.catch((err: Error) => {
				removeLoader();
				addToMessages(
					new Text(
						chalk.red('Catchup failed: ') + chalk.dim(err.message),
						1,
						0,
					),
				);
				addToMessages(new Spacer(1));
				tui.requestRender();
			});
	}

	function continueCatchupInNewChat(): void {
		if (!pendingCatchupSummary) return;
		const seed = pendingCatchupSummary;
		if (catchupViewContainer) {
			try { tui.removeChild(catchupViewContainer); } catch { /* ignore */ }
			catchupViewContainer = null;
			restoreMainUI();
		}
		pendingCatchupSummary = null;
		clearConversation();
		editor.setText(seed + '\n\n');
		tui.setFocus(editor);
		tui.requestRender();
	}

	function removeLoader(): void {
		if (!loaderVisible) return;
		const idx = conversationComponents.lastIndexOf(loader);
		if (idx !== -1) conversationComponents.splice(idx, 1);
		try {
			messagesContainer.removeChild(loader);
		} catch {
			// ignore
		}
		loader.stop();
		loaderVisible = false;
	}

	function showLoader(): void {
		if (loaderVisible) {
			loader.stop();
			loader.start();
			return;
		}
		conversationComponents.push(loader);
		messagesContainer.addChild(loader);
		loader.stop();   // clear any existing interval before restarting
		loader.start();
		loaderVisible = true;
	}

	function showOutOfCreditsToast(): void {
		addToMessages(
			new Text(
				chalk.red('You’re out of credits. ') +
					chalk.dim('Top up at ') +
					chalk.white(baseUrl + '/settings/billing'),
				1,
				0,
			),
		);
		addToMessages(new Spacer(1));
	}

	function runMessage(message: string): void {
		if (outOfCredits()) {
			showOutOfCreditsToast();
			tui.requestRender();
			return;
		}
		isProcessing = true;
		editor.disableSubmit = true;
		const myRequestId = ++requestId;

		// User bubble — leading blank line so consecutive turns don't run
		// into the previous assistant reply.
		addToMessages(new Spacer(1));
		addToMessages(
			new Text(
				chalk.bgHex('#3a3a3a').white(' \u276f ' + message + ' '),
				0,
				0,
			),
		);
		addToMessages(new Spacer(1));

		showLoader();

		const responseMd = new Markdown('', 1, 0, markdownTheme);
		let accumulated = '';
		let markdownInserted = false;
		let hadOutput = false;
		let hadErrorMessage = false;

		const callbacks = {
			onTextDelta(delta: string) {
				if (requestId !== myRequestId) return;
				accumulated += delta;
				hadOutput = true;

				if (!markdownInserted) {
					insertBeforeLoader(responseMd);
					markdownInserted = true;
				}

				responseMd.setText(accumulated);
				tui.requestRender();
			},

			onToolStart(_id: string, _name: string, item: ToolCallItem) {
				if (requestId !== myRequestId) return;
				hadOutput = true;
				allToolItems.push(item);
				insertBeforeLoader(item);
				tui.requestRender();
			},

			onRerender() {
				if (requestId !== myRequestId) return;
				tui.requestRender();
			},

			onStepFinish() {
				if (requestId !== myRequestId) return;
				tui.requestRender();
			},

			onFinish() {
				if (requestId !== myRequestId) return;
				removeLoader();

				if (!hadOutput && !hadErrorMessage) {
					addToMessages(new Text(chalk.gray('(no response)'), 1, 0));
					addToMessages(new Spacer(1));
				}

				isProcessing = false;
				editor.disableSubmit = false;
				// If the scratchpad panel is open the agent may have called
				// `update_scratchpad` — refresh so the panel reflects new content.
				scratchpadPanel?.refresh().catch(() => {});
				tui.requestRender();
			},

			onAbort() {
				if (requestId !== myRequestId) return;
				removeLoader();
				// Remove pending approval panel if present
				if (pendingApprovalPanel) {
					try { messagesContainer.removeChild(pendingApprovalPanel); } catch { /* ignore */ }
					const idx = conversationComponents.lastIndexOf(pendingApprovalPanel);
					if (idx !== -1) conversationComponents.splice(idx, 1);
					pendingApprovalPanel = null;
				}
				addToMessages(
					new Text(
						chalk.dim('Interrupted · What should ') +
							chalk.white(butlerName) +
							chalk.dim(' do instead?'),
						1,
						0,
					),
				);
				addToMessages(new Spacer(1));
				isProcessing = false;
				editor.disableSubmit = false;
				tui.requestRender();
			},

			onError(err: Error) {
				if (requestId !== myRequestId) return;
				removeLoader();
				hadErrorMessage = true;
				const code = (err as {code?: string}).code;
				const isNoCredits = err instanceof NoCreditsError || code === 'no_credits';
				if (isNoCredits) {
					// Server told us we're out — flip local state so the border
					// turns red immediately and future submits short-circuit.
					if (creditsInfo) creditsInfo.available = 0;
					refreshBorder();
					addToMessages(
						new Text(
							chalk.red('You’re out of credits. ') +
								chalk.dim('Top up at ') +
								chalk.white(baseUrl + '/settings/billing'),
							1,
							0,
						),
					);
				} else {
					// Empty message often means the server emitted a bare SSE
					// `error` event with no payload — surface something
					// actionable instead of a lone "Error:" line.
					const message = err.message?.trim() || 'Stream ended unexpectedly (no error message from server).';
					addToMessages(
						new Text(chalk.red('Error: ') + chalk.gray(message), 1, 0),
					);
					// Any stream failure could be a credit gate that raced past
					// our poll — refresh so the border reflects reality.
					refreshCredits().catch(() => {});
				}
				addToMessages(new Spacer(1));
				isProcessing = false;
				editor.disableSubmit = false;
				tui.requestRender();
			},

			onApprovalRequested(approvalId: string, toolCallId: string, toolName: string, input?: Record<string, unknown>) {
				if (requestId !== myRequestId) return;
				hadOutput = true;

				// If accept-all is active, silently approve without showing the panel
				if (autoApproveAll) {
					showLoader();
					conversation.approve(true, toolCallId, callbacks).catch(() => {});
					return;
				}

				if (!pendingApprovalPanel) {
					// First approval — create the panel and hide the loader
					removeLoader();
					const panel = new ApprovalPanel(accountFrontendMap, () => tui.requestRender());
					pendingApprovalPanel = panel;
					addToMessages(panel);

					panel.onAllDecided = (result) => {
						// Remove the approval panel
						try { messagesContainer.removeChild(panel); } catch { /* ignore */ }
						const pidx = conversationComponents.lastIndexOf(panel);
						if (pidx !== -1) conversationComponents.splice(pidx, 1);
						pendingApprovalPanel = null;

						if (result.acceptAllFuture) {
							autoApproveAll = true;
							statusLine.setAcceptAll(true);
						}

						showLoader();
						tui.requestRender();

						// Submit decisions sequentially — one approve() call per tool
						(async () => {
							for (const [toolCallId, approved] of result.decisions) {
								try {
									await conversation.approve(approved, toolCallId, callbacks);
								} catch {
									// errors handled via onError
								}
							}
						})();
					};
				}

				// Add this tool to the panel (may be first or additional)
				pendingApprovalPanel.addApproval({approvalId, toolCallId, toolName, input});
				tui.requestRender();
			},
		};

		conversation
			.send(message, callbacks)
			.catch(() => {
				// errors are handled via onError callback
			});
	}

	// ── Global input ──────────────────────────────────────────────────────────

	tui.addInputListener(data => {
		if (data === '\x03') {
			statusLine.dispose();
			tui.stop();
			process.stdout.write('\n');
			process.exit(0);
		}

		// Esc during processing — abort the stream (also clears any pending approval)
		if (isProcessing && matchesKey(data, Key.escape)) {
			conversation.abort();
			return;
		}

		// ── Approval mode input ───────────────────────────────────────────────
		if (pendingApprovalPanel) {
			// Up arrow
			if (data === '\x1b[A') {
				pendingApprovalPanel.moveUp();
				tui.requestRender();
				return;
			}
			// Down arrow
			if (data === '\x1b[B') {
				pendingApprovalPanel.moveDown();
				tui.requestRender();
				return;
			}
			// Shift+Tab → jump to "Yes, allow all"
			if (data === '\x1b[Z') {
				pendingApprovalPanel.selectAllowAll();
				tui.requestRender();
				return;
			}
			// Enter / Space → confirm selected option
			if (data === '\r' || data === '\n' || data === ' ') {
				pendingApprovalPanel.confirm();
				return;
			}
			// Direct number keys 1 / 2 / 3
			if (data === '1') { pendingApprovalPanel.confirm(0); return; }
			if (data === '2') { pendingApprovalPanel.confirm(1); return; }
			if (data === '3') { pendingApprovalPanel.confirm(2); return; }
			// Block all other input while approval is pending
			return;
		}

		// ── Tab+Tab on empty input → enter create-task mode ──────────────────
		if (data === '\t' && !overlayActive) {
			if (editor.getText().trim() === '') {
				const now = Date.now();
				if (lastTabAt !== null && now - lastTabAt < TAB_DOUBLE_TAP_MS) {
					lastTabAt = null;
					setNewTaskMode(true);
					return {consume: true};
				}
				lastTabAt = now;
				return {consume: true};
			}
			// Non-empty input: editor handles Tab (autocomplete completion).
			lastTabAt = null;
		}

		// Any non-Tab key cancels the pending double-tap window.
		if (data !== '\t') {
			lastTabAt = null;
		}

		// ── Esc exits create-task mode without submitting ────────────────────
		if (newTaskMode && matchesKey(data, Key.escape) && !overlayActive) {
			setNewTaskMode(false);
			return {consume: true};
		}

		// ── Down arrow on empty editor → focus status line zone selector ───
		if (
			!overlayActive &&
			!isProcessing &&
			!newTaskMode &&
			!statusLine.focused &&
			matchesKey(data, Key.down) &&
			editor.getText().length === 0
		) {
			statusLine.setSelectedZone('tasks');
			tui.setFocus(statusLine);
			tui.requestRender();
			return {consume: true};
		}

		// ── Catchup view input (only when the modal view is up) ────────────
		if (catchupViewContainer) {
			if (data === 'c' || data === 'C') {
				continueCatchupInNewChat();
				return {consume: true};
			}
			if (matchesKey(data, Key.escape)) {
				closeCatchupView();
				return {consume: true};
			}
			// Block other keys while the catchup modal is up — no editor,
			// no accidental slash-commands.
			return {consume: true};
		}

		// ── Scratchpad day nav (Ctrl+P prev · Ctrl+N next) ─────────────────
		if (scratchpadPanel && !overlayActive && !isProcessing && !statusLine.focused) {
			if (matchesKey(data, Key.ctrl('p'))) {
				scratchpadPanel.shiftDays(-1);
				return {consume: true};
			}
			if (matchesKey(data, Key.ctrl('n'))) {
				scratchpadPanel.shiftDays(1);
				return {consume: true};
			}
		}

		if (matchesKey(data, Key.ctrl('o'))) {
			if (taskInfoOverlay) {
				taskInfoOverlay.onCancel?.();
				return;
			}
			if (currentTask && !overlayActive && !isProcessing) {
				showTaskInfoOverlay(currentTask);
				return;
			}
			if (allToolItems.length > 0) {
				const anyExpanded = allToolItems.some(item => item.isExpanded);
				for (const item of allToolItems) {
					item.isExpanded = !anyExpanded;
				}
				tui.requestRender();
			}

			return;
		}

		// ── Ctrl+R → show runs of the current recurring task ──────────────
		if (
			!overlayActive &&
			!isProcessing &&
			currentTask &&
			isRecurringTask(currentTask) &&
			matchesKey(data, Key.ctrl('r'))
		) {
			showTaskRunsOverlay(currentTask);
			return {consume: true};
		}

		if (!overlayActive && matchesKey(data, Key.ctrl('i'))) {
			toggleIncognito();
			return;
		}

		return undefined;
	});

	// Load below-input widget from saved config
	loadBelowInputWidget().catch(() => {});

	tui.start();
}
