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
import {editorTheme, markdownTheme} from './themes.js';
import {createConversation} from './hooks/use-conversation.js';
import {ToolCallItem} from './components/tool-call-item.js';

export function startTuiApp(
	baseUrl: string,
	apiKey: string,
	version: string,
): void {
	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);

	// ── Header ───────────────────────────────────────────────────────────────
	const c = (s: string) => chalk.hex('#4ade80')(s);
	const logoRows = [
		c('    ▄▄▄▄▄▄▄   '),
		c('  ▄█████████▄ '),
		c(' ▐███████████▌'),
		c(' ▐██ ▄▄ ▄▄ ██▌'),
		c(' ▐██ ██ ██ ██▌'),
		c(' ▐██▄▄▄▄▄▄▄██▌'),
		c('  ▀█████████▀ '),
	];
	const infoRows: string[] = [
		'',
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
			[{name: 'clear', description: 'Clear conversation and start fresh'}],
			process.cwd(),
		),
	);
	tui.addChild(editor);
	tui.setFocus(editor);

	// ── State ─────────────────────────────────────────────────────────────────
	let isProcessing = false;
	let allToolItems: ToolCallItem[] = [];
	let conversationComponents: Component[] = [];

	const conversation = createConversation(baseUrl, apiKey);

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

	function clearConversation(): void {
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

		if (isProcessing || !trimmed) return;
		runMessage(trimmed);
	};

	function runMessage(message: string): void {
		isProcessing = true;
		editor.disableSubmit = true;

		// User bubble
		addToMessages(new Text(chalk.dim('\u2502 ') + chalk.white(message), 0, 0));
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
					hadOutput = true;
					allToolItems.push(item);
					insertBeforeLoader(item);
					tui.requestRender();
				},

				onRerender() {
					tui.requestRender();
				},

				onStepFinish() {
					tui.requestRender();
				},

				onFinish() {
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

				onError(err) {
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

		if (matchesKey(data, Key.ctrl('o'))) {
			if (allToolItems.length > 0) {
				const last = allToolItems[allToolItems.length - 1];
				last.toggleExpand();
				tui.requestRender();
			}

			return;
		}

		return undefined;
	});

	tui.start();
}
