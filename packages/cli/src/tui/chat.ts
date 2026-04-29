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
} from '@mariozechner/pi-tui';
import type {Component} from '@mariozechner/pi-tui';
import {buildAvatar} from './utils/avatar.js';
import chalk from 'chalk';
import {StatusLine} from './components/status-line.js';
import {editorTheme, markdownTheme} from './themes.js';
import {createConversation} from './hooks/use-conversation.js';
import {ToolCallItem} from './components/tool-call-item.js';
import {ConversationSelector} from './components/conversation-selector.js';
import {ReminderList} from './components/reminder-list.js';
import {TaskList} from './components/task-list.js';
import {TaskDetail} from './components/task-detail.js';
import type {TaskSummary} from './utils/stream.js';
import {IntegrationsView} from './components/integrations-view.js';
import {WidgetsView} from './components/widgets-view.js';
import {DashboardView} from './components/dashboard-view.js';
import {loadWidgetBundle} from './utils/widget-loader.js';
import {getPreferences} from '../config/preferences.js';
import {fetchConversationHistory, fetchWorkspace, fetchIntegrationAccounts, openBrowser, createTaskApi} from './utils/stream.js';
import type {HistoryMessage} from './utils/stream.js';
import {getToolDisplayName} from './utils/tool-names.js';
import {ApprovalPanel} from './components/approval-panel.js';

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
	tui.addChild(messagesContainer);

	// ── Task title bar (shown above editor when in a task conversation) ─────
	const taskTitleContainer = new Container();
	tui.addChild(taskTitleContainer);

	// ── Editor ────────────────────────────────────────────────────────────────
	const editor = new Editor(tui, editorTheme);
	editor.setAutocompleteProvider(
		new CombinedAutocompleteProvider(
			[
				{name: 'clear', description: 'Clear conversation and start fresh'},
				{name: 'resume', description: 'Resume a previous conversation'},
				{name: 'reminders', description: 'View your reminders'},
				{name: 'tasks', description: 'View and manage your tasks'},
				{name: 'integrations', description: 'View and connect integrations'},
				{name: 'widgets', description: 'Configure widgets (below-input & overview)'},
				{name: 'dashboard', description: 'Show overview widgets in TUI'},
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

	// ── Status line (incognito + below-input widget on one row) ──────────────
	const statusLine = new StatusLine();
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
	let currentTask: TaskSummary | null = null;
	let taskInfoOverlay: TaskDetail | null = null;

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
		// Remove loader, add component, re-add loader
		try {
			messagesContainer.removeChild(loader);
		} catch {
			// loader not in tree yet
		}

		messagesContainer.addChild(component);
		messagesContainer.addChild(loader);
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

	function setTaskContext(task: TaskSummary | null): void {
		currentTask = task;
		taskTitleContainer.clear();
		if (task) {
			const id = task.displayId ? chalk.dim(`[${task.displayId}] `) : '';
			const title = chalk.bold.white(task.title || 'Untitled');
			const status = chalk.cyan(`(${task.status})`);
			const hint = chalk.dim('   ctrl+o info');
			taskTitleContainer.addChild(
				new Text(`${id}${title} ${status}${hint}`, 1, 0),
			);
		}
		tui.requestRender();
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

		if (trimmed === '/reminders') {
			showReminderList();
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

		if (trimmed === '/dashboard') {
			showDashboardView();
			return;
		}

		if (trimmed === '/incognito') {
			toggleIncognito();
			return;
		}

		if (trimmed === '/exit') {
			tui.stop();
			process.stdout.write('\n');
			process.exit(0);
		}

		if (isProcessing || !trimmed) return;
		runMessage(trimmed);
	};

	function hideMainUI(): void {
		try { tui.removeChild(statusLine); } catch { /* ignore */ }
		tui.removeChild(messagesContainer);
		try { tui.removeChild(taskTitleContainer); } catch { /* ignore */ }
		tui.removeChild(editor);
		overlayActive = true;
	}

	function restoreMainUI(): void {
		overlayActive = false;
		tui.addChild(messagesContainer);
		tui.addChild(taskTitleContainer);
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

				// Result preview (first 3 non-empty lines)
				const resultStr = stringifyToolOutput(part.output);
				if (resultStr) {
					const previewLines = resultStr
						.split('\n')
						.filter(l => l.trim().length > 0)
						.slice(0, 3);
					for (const line of previewLines) {
						addToMessages(new Text(chalk.dim('  ' + line), 1, 0));
					}
				}

				any = true;
				continue;
			}

			// ── data-tool-agent / step-start / unknown ────────────────────────
			// Silently skip — these are streaming-protocol artifacts.
		}

		return any;
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

	function showReminderList(): void {
		hideMainUI();

		const list = new ReminderList(baseUrl, apiKey, tui, () =>
			tui.requestRender(),
		);
		tui.addChild(list);
		tui.setFocus(list);

		list.onCancel = () => {
			tui.removeChild(list);
			restoreMainUI();
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

	function showDashboardView(): void {
		hideMainUI();

		const view = new DashboardView(baseUrl, apiKey, tui, () =>
			tui.requestRender(),
		);
		tui.addChild(view);
		tui.setFocus(view);

		view.onCancel = () => {
			tui.removeChild(view);
			restoreMainUI();
		};
	}

	function removeLoader(): void {
		const idx = conversationComponents.lastIndexOf(loader);
		if (idx !== -1) conversationComponents.splice(idx, 1);
		try {
			messagesContainer.removeChild(loader);
		} catch {
			// ignore
		}
		loader.stop();
	}

	function showLoader(): void {
		conversationComponents.push(loader);
		messagesContainer.addChild(loader);
		loader.stop();   // clear any existing interval before restarting
		loader.start();
	}

	function runMessage(message: string): void {
		isProcessing = true;
		editor.disableSubmit = true;
		const myRequestId = ++requestId;

		// User bubble
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

				if (!hadOutput) {
					addToMessages(new Text(chalk.gray('(no response)'), 1, 0));
				}

				addToMessages(new Spacer(1));
				isProcessing = false;
				editor.disableSubmit = false;
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
				addToMessages(
					new Text(chalk.red('Error: ') + chalk.gray(err.message), 1, 0),
				);
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
