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
import chalk from 'chalk';
import {StatusLine} from './components/status-line.js';
import {editorTheme, markdownTheme} from './themes.js';
import {createConversation} from './hooks/use-conversation.js';
import {ToolCallItem} from './components/tool-call-item.js';
import {ConversationSelector} from './components/conversation-selector.js';
import {ReminderList} from './components/reminder-list.js';
import {IntegrationsView} from './components/integrations-view.js';
import {WidgetsView} from './components/widgets-view.js';
import {DashboardView} from './components/dashboard-view.js';
import {loadWidgetBundle} from './utils/widget-loader.js';
import {getPreferences} from '../config/preferences.js';
import {fetchConversationHistory, fetchWorkspace, openBrowser} from './utils/stream.js';

export function startTuiApp(
	baseUrl: string,
	apiKey: string,
	version: string,
): void {
	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);

	// ── Header ───────────────────────────────────────────────────────────────
	const c = (s: string) => chalk.hex('#c15e50')(s);
	const logoRows = [
		c(' ▄███▄  '),
		c(' ▐◉███◉▌ '),
		c(' ▐█████▌'),
		c('  ◉   ◉  '),
	];
	const infoRows: string[] = [
		'',
		chalk.bold.white('CORE') + '  ' + chalk.dim('v' + version),
		chalk.gray('ctrl+c to exit'),
		'',
		'',
	];
	for (let i = 0; i < logoRows.length; i++) {
		tui.addChild(
			new Text(
				logoRows[i] + (infoRows[i] ? '  ' + infoRows[i] : ''),
				i === 0 ? 1 : 0,
				0,
			),
		);
	}
	tui.addChild(new Spacer(1));

	// ── Messages area ─────────────────────────────────────────────────────────
	const messagesContainer = new Container();
	tui.addChild(messagesContainer);

	// ── Editor ────────────────────────────────────────────────────────────────
	const editor = new Editor(tui, editorTheme);
	editor.setAutocompleteProvider(
		new CombinedAutocompleteProvider(
			[
				{name: 'clear', description: 'Clear conversation and start fresh'},
				{name: 'resume', description: 'Resume a previous conversation'},
				{name: 'reminders', description: 'View your reminders'},
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
			const mod = await loadWidgetBundle(cfg.widgetUrl);
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
	let overlayActive = false;
	let isProcessing = false;
	let allToolItems: ToolCallItem[] = [];
	let conversationComponents: Component[] = [];
	let requestId = 0;
	let butlerName = 'CORE'; // replaced once workspace loads

	const conversation = createConversation(baseUrl, apiKey);

	// Fetch workspace name async — used in interrupted prompt
	fetchWorkspace(baseUrl, apiKey)
		.then(ws => {
			if (ws?.name) butlerName = ws.name;
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
		conversation.clear();
		isProcessing = false;
		editor.disableSubmit = false;
		tui.requestRender();
	}

	// ── Submit ────────────────────────────────────────────────────────────────

	editor.onSubmit = (message: string) => {
		const trimmed = message.trim();

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
		tui.removeChild(editor);
		overlayActive = true;
	}

	function restoreMainUI(): void {
		overlayActive = false;
		tui.addChild(messagesContainer);
		tui.addChild(editor);
		tui.addChild(statusLine);
		tui.setFocus(editor);
		tui.requestRender();
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

			const historyLoader = new Loader(
				tui,
				s => chalk.cyan(s),
				s => chalk.gray(s),
				'Loading history...',
			);
			messagesContainer.addChild(historyLoader);
			historyLoader.start();
			tui.requestRender();

			fetchConversationHistory(baseUrl, apiKey, conv.id)
				.then(({messages, incognito: convIncognito}) => {
					messagesContainer.removeChild(historyLoader);
					historyLoader.stop();

					if (convIncognito && !conversation.incognito) {
						conversation.toggleIncognito();
						statusLine.setIncognito(true);
					}

					for (const msg of messages) {
						const text = msg.parts
							.filter(p => p.type === 'text' && p.text)
							.map(p => p.text ?? '')
							.join('');

						if (!text) continue;

						if (msg.role === 'user') {
							addToMessages(
								new Text(
									chalk.bgHex('#3a3a3a').white(' \u276f ' + text + ' '),
									0,
									0,
								),
							);
						} else {
							addToMessages(new Markdown(text, 1, 0, markdownTheme));
						}
						addToMessages(new Spacer(1));
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

		// Loader
		conversationComponents.push(loader);
		messagesContainer.addChild(loader);
		loader.start();

		const responseMd = new Markdown('', 1, 0, markdownTheme);
		let accumulated = '';
		let markdownInserted = false;
		let hadOutput = false;

		conversation
			.send(message, {
				onTextDelta(delta) {
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

				onToolStart(_id, _name, item) {
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
					// Remove loader from tracked list
					const idx = conversationComponents.lastIndexOf(loader);
					if (idx !== -1) conversationComponents.splice(idx, 1);

					try {
						messagesContainer.removeChild(loader);
					} catch {
						// ignore
					}

					loader.stop();

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
					const idx = conversationComponents.lastIndexOf(loader);
					if (idx !== -1) conversationComponents.splice(idx, 1);

					try {
						messagesContainer.removeChild(loader);
					} catch {
						// ignore
					}

					loader.stop();
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

				onError(err) {
					if (requestId !== myRequestId) return;
					const idx = conversationComponents.lastIndexOf(loader);
					if (idx !== -1) conversationComponents.splice(idx, 1);

					try {
						messagesContainer.removeChild(loader);
					} catch {
						// ignore
					}

					loader.stop();
					addToMessages(
						new Text(chalk.red('Error: ') + chalk.gray(err.message), 1, 0),
					);
					addToMessages(new Spacer(1));
					isProcessing = false;
					editor.disableSubmit = false;
					tui.requestRender();
				},
			})
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

		// Esc during processing — abort the stream
		if (isProcessing && matchesKey(data, Key.escape)) {
			conversation.abort();
			return;
		}

		if (matchesKey(data, Key.ctrl('o'))) {
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
