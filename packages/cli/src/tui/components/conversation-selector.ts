import {
	SelectList,
	Text,
	Spacer,
	Container,
	Loader,
	matchesKey,
} from '@mariozechner/pi-tui';
import type {Component, TUI} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import {fetchConversations} from '../utils/stream.js';
import type {ConversationSummary} from '../utils/stream.js';

const selectListTheme = {
	selectedPrefix: (s: string) => chalk.cyan(s),
	selectedText: (s: string) => chalk.white(s),
	description: (s: string) => chalk.gray(s),
	scrollInfo: (s: string) => chalk.gray(s),
	noMatch: (s: string) => chalk.gray(s),
};

const PAGE_SIZE = 20;
const LOAD_MORE_THRESHOLD = 3;

export class ConversationSelector implements Component {
	private container: Container;
	private headerText: Text;
	private listContainer: Container;
	private list: SelectList | null = null;

	private conversations: ConversationSummary[] = [];
	private page = 1;
	private hasNext = false;
	private loading = false;
	private sourceFilter: 'cli' | undefined = undefined;

	onSelect?: (conversation: ConversationSummary) => void;
	onCancel?: () => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private tui: TUI,
		private onRender: () => void,
	) {
		this.container = new Container();
		this.listContainer = new Container();

		this.container.addChild(new Spacer(1));
		this.headerText = new Text('', 1, 0);
		this.container.addChild(this.headerText);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.listContainer);

		this.load(true);
	}

	private updateHeader(): void {
		const filter =
			this.sourceFilter === 'cli'
				? chalk.cyan('[CLI only]')
				: chalk.dim('[All sources]');
		this.headerText.setText(
			chalk.bold.white('Resume a conversation') +
				'  ' +
				filter +
				chalk.dim('  ↑↓ navigate · Enter select · f filter · Esc cancel'),
		);
	}

	private buildItems() {
		return this.conversations.map(c => ({
			value: c.id,
			label: c.title ?? chalk.italic('Untitled'),
			description:
				chalk.dim(c.source ?? 'unknown') +
				'  ' +
				new Date(c.updatedAt).toLocaleString(),
		}));
	}

	private rebuildList(): void {
		// Remove old list
		if (this.list) {
			try {
				this.listContainer.removeChild(this.list);
			} catch {
				// ignore
			}
		}

		const items = this.buildItems();

		if (items.length === 0) {
			const empty = new Text(chalk.gray('No conversations found.'), 1, 0);
			this.listContainer.addChild(empty);
			this.list = null;
			return;
		}

		this.list = new SelectList(items, 15, selectListTheme);

		this.list.onSelect = item => {
			const conv = this.conversations.find(c => c.id === item.value);
			if (conv) this.onSelect?.(conv);
		};

		this.list.onCancel = () => this.onCancel?.();

		this.list.onSelectionChange = item => {
			// Auto-load more when within LOAD_MORE_THRESHOLD of the end
			const idx = this.conversations.findIndex(c => c.id === item.value);
			if (
				this.hasNext &&
				!this.loading &&
				idx >= this.conversations.length - LOAD_MORE_THRESHOLD
			) {
				this.load(false);
			}
		};

		this.listContainer.addChild(this.list);
	}

	private load(reset: boolean): void {
		if (this.loading) return;
		this.loading = true;

		if (reset) {
			this.conversations = [];
			this.page = 1;

			// Show spinner in listContainer while initial load
			const loaderComp = new Loader(
				this.tui,
				(s: string) => chalk.cyan(s),
				(s: string) => chalk.gray(s),
				'Loading conversations...',
			);
			loaderComp.start();
			if (this.list) {
				try {
					this.listContainer.removeChild(this.list);
				} catch {
					// ignore
				}
				this.list = null;
			}
			this.listContainer.addChild(loaderComp);
			this.updateHeader();
			this.onRender();

			fetchConversations(
				this.baseUrl,
				this.apiKey,
				1,
				PAGE_SIZE,
				this.sourceFilter,
			)
				.then(result => {
					loaderComp.stop();
					this.listContainer.removeChild(loaderComp);
					this.conversations = result.conversations;
					this.hasNext = result.hasNext;
					this.page = 2;
					this.loading = false;
					this.rebuildList();
					this.onRender();
				})
				.catch((err: Error) => {
					loaderComp.stop();
					this.listContainer.removeChild(loaderComp);
					this.listContainer.addChild(
						new Text(chalk.red('Error: ') + chalk.gray(err.message), 1, 0),
					);
					this.loading = false;
					this.onRender();
				});
		} else {
			// Append next page
			fetchConversations(
				this.baseUrl,
				this.apiKey,
				this.page,
				PAGE_SIZE,
				this.sourceFilter,
			)
				.then(result => {
					this.conversations = [...this.conversations, ...result.conversations];
					this.hasNext = result.hasNext;
					this.page++;
					this.loading = false;
					this.rebuildList();
					this.onRender();
				})
				.catch(() => {
					this.loading = false;
				});
		}
	}

	handleInput(data: string): void {
		// Toggle source filter with 'f'
		if (matchesKey(data, 'f')) {
			this.sourceFilter =
				this.sourceFilter === 'cli' ? undefined : 'cli';
			this.load(true);
			return;
		}

		this.list?.handleInput?.(data);
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate?.();
	}
}
