import {
	Text,
	Spacer,
	Container,
	Loader,
	matchesKey,
	Key,
	truncateToWidth,
	visibleWidth,
} from '@earendil-works/pi-tui';
import type {Component, TUI} from '@earendil-works/pi-tui';
import chalk from 'chalk';
import {fetchConversations} from '../utils/stream.js';
import type {ConversationSummary} from '../utils/stream.js';

const INITIAL_PAGE_SIZE = 20;
const APPEND_PAGE_SIZE = 10;
const LOAD_MORE_THRESHOLD = 3; // when cursor is within N of loaded end, prefetch more

/**
 * Resume-a-conversation picker. Owns its own layout + input handling — no
 * SelectList, so pi-tui's differential renderer has nothing to interfere
 * with. Items render as a plain list of Text lines under a Container, with
 * a single visible cursor row (`→`) that we manage directly.
 *
 * Pagination is transparent: we prefetch the next {@link APPEND_PAGE_SIZE}
 * page as soon as the cursor gets within {@link LOAD_MORE_THRESHOLD} of the
 * last loaded row. New items append silently — the cursor position stays
 * on the row the user was looking at.
 */
export class ConversationSelector implements Component {
	private container: Container;
	private headerText: Text;
	private hintText: Text;
	private bodyContainer: Container;

	private conversations: ConversationSummary[] = [];
	private cursor = 0;
	private windowTop = 0;
	private page = 1;
	private hasNext = false;
	private loading = false;
	private sourceFilter: 'cli' | undefined;
	private didInitialLoad = false;

	onSelect?: (conversation: ConversationSummary) => void;
	onCancel?: () => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private tui: TUI,
		private onRender: () => void,
	) {
		this.container = new Container();
		this.headerText = new Text('', 1, 0);
		this.hintText = new Text('', 1, 0);
		this.bodyContainer = new Container();

		this.container.addChild(new Spacer(1));
		this.container.addChild(this.headerText);
		this.container.addChild(this.hintText);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.bodyContainer);

		this.updateHeader();
		void this.initialLoad();
	}

	// ── Layout ────────────────────────────────────────────────────────────────

	private visibleRows(): number {
		// Reserve rows for: spacer + header + hint + spacer + prompt area (~10)
		return Math.max(4, this.tui.terminal.rows - 10);
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	private updateHeader(): void {
		const filter =
			this.sourceFilter === 'cli'
				? chalk.cyan('[CLI only]')
				: chalk.dim('[All sources]');
		this.headerText.setText(
			chalk.bold.white('Resume a conversation') + '  ' + filter,
		);
		this.hintText.setText(
			chalk.dim('↑↓ navigate · Enter select · f filter · Esc cancel'),
		);
	}

	private redrawBody(): void {
		this.bodyContainer.clear();

		if (this.loading && this.conversations.length === 0) {
			const loader = new Loader(
				this.tui,
				(s: string) => chalk.cyan(s),
				(s: string) => chalk.dim(s),
				'Loading conversations...',
			);
			loader.start();
			this.bodyContainer.addChild(loader);
			return;
		}

		if (this.conversations.length === 0) {
			this.bodyContainer.addChild(
				new Text(chalk.dim('No conversations found.'), 1, 0),
			);
			return;
		}

		// Slide the window so the cursor stays visible.
		const rows = this.visibleRows();
		if (this.cursor < this.windowTop) this.windowTop = this.cursor;
		if (this.cursor >= this.windowTop + rows) this.windowTop = this.cursor - rows + 1;
		if (this.windowTop < 0) this.windowTop = 0;
		const end = Math.min(this.conversations.length, this.windowTop + rows);

		for (let i = this.windowTop; i < end; i++) {
			this.bodyContainer.addChild(this.renderRow(i));
		}

		// Footer: cursor position + optional loading hint for appended pages.
		const total = this.conversations.length;
		const hasMore = this.hasNext ? ' · more available' : '';
		const loadingMore = this.loading ? chalk.cyan(' · loading…') : '';
		this.bodyContainer.addChild(new Spacer(1));
		this.bodyContainer.addChild(
			new Text(
				chalk.dim(`${this.cursor + 1}/${total}${hasMore}${loadingMore}`),
				1,
				0,
			),
		);
	}

	private renderRow(index: number): Text {
		const conv = this.conversations[index];
		const isSelected = index === this.cursor;

		const prefix = isSelected ? chalk.cyan('→ ') : '  ';
		// Titles can arrive with HTML, embedded newlines, or bullet-list
		// markers — collapse to a single-line summary so each conversation
		// occupies exactly one row.
		const rawTitle =
			(conv.title ?? '')
				.replace(/<[^>]*>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim() || 'Untitled';
		const source = chalk.dim(conv.source ?? 'unknown');
		const when = chalk.dim(new Date(conv.updatedAt).toLocaleString());
		const meta = `${source}  ${when}`;

		// Fill the row across the terminal width: title on the left, meta on
		// the right. Truncate title if the meta doesn't fit.
		const cols = this.tui.terminal.columns ?? 80;
		const usable = Math.max(20, cols - 4);
		const metaWidth = visibleWidth(meta);
		const titleBudget = Math.max(10, usable - metaWidth - visibleWidth(prefix) - 2);
		const title = isSelected
			? chalk.bold.white(truncateToWidth(rawTitle, titleBudget))
			: chalk.white(truncateToWidth(rawTitle, titleBudget));
		const gap = ' '.repeat(
			Math.max(2, usable - visibleWidth(prefix) - visibleWidth(title) - metaWidth),
		);
		return new Text(prefix + title + gap + meta, 1, 0);
	}

	// ── Data ──────────────────────────────────────────────────────────────────

	private async initialLoad(): Promise<void> {
		this.loading = true;
		this.conversations = [];
		this.cursor = 0;
		this.windowTop = 0;
		this.page = 1;
		this.redrawBody();
		this.forceRender();

		try {
			const result = await fetchConversations(
				this.baseUrl,
				this.apiKey,
				1,
				INITIAL_PAGE_SIZE,
				this.sourceFilter,
			);
			const seen = new Set<string>();
			this.conversations = result.conversations.filter(c => {
				if (seen.has(c.id)) return false;
				seen.add(c.id);
				return true;
			});
			this.hasNext = result.hasNext;
			this.page = 2;
			this.didInitialLoad = true;
		} catch {
			// swallow; empty state renders
		} finally {
			this.loading = false;
			this.redrawBody();
			this.forceRender();
		}
	}

	private async loadMore(): Promise<void> {
		if (this.loading || !this.hasNext) return;
		this.loading = true;
		this.redrawBody();
		this.onRender();

		try {
			const result = await fetchConversations(
				this.baseUrl,
				this.apiKey,
				this.page,
				APPEND_PAGE_SIZE,
				this.sourceFilter,
			);
			const seen = new Set(this.conversations.map(c => c.id));
			const fresh = result.conversations.filter(c => !seen.has(c.id));
			this.conversations.push(...fresh);
			this.hasNext = result.hasNext;
			this.page++;
		} catch {
			// swallow — keep what we have
		} finally {
			this.loading = false;
			this.redrawBody();
			this.onRender();
		}
	}

	private maybePrefetch(): void {
		if (!this.didInitialLoad) return;
		if (this.loading || !this.hasNext) return;
		if (this.cursor >= this.conversations.length - LOAD_MORE_THRESHOLD) {
			void this.loadMore();
		}
	}

	// ── Input ─────────────────────────────────────────────────────────────────

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.onCancel?.();
			return;
		}
		if (matchesKey(data, 'f')) {
			this.sourceFilter = this.sourceFilter === 'cli' ? undefined : 'cli';
			this.updateHeader();
			void this.initialLoad();
			return;
		}
		if (matchesKey(data, Key.up)) {
			if (this.conversations.length === 0) return;
			this.cursor = this.cursor === 0
				? this.conversations.length - 1
				: this.cursor - 1;
			this.redrawBody();
			this.onRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			if (this.conversations.length === 0) return;
			this.cursor = this.cursor === this.conversations.length - 1
				? 0
				: this.cursor + 1;
			this.redrawBody();
			this.onRender();
			this.maybePrefetch();
			return;
		}
		if (data === '\r' || data === '\n') {
			const picked = this.conversations[this.cursor];
			if (picked) this.onSelect?.(picked);
			return;
		}
	}

	// ── Component boilerplate ────────────────────────────────────────────────

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate?.();
	}

	private forceRender(): void {
		// Full re-render clears any stale rows pi-tui's diff renderer might
		// have left in the terminal buffer when the tree shape changes.
		this.tui.requestRender(true);
	}
}
