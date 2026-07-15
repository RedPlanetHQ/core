import {Text, Spacer, Container, Markdown} from '@earendil-works/pi-tui';
import type {Component} from '@earendil-works/pi-tui';
import chalk from 'chalk';
import {fetchPageByDate, fetchPageContent} from '../utils/stream.js';
import {htmlToMarkdown} from '../utils/html-to-md.js';
import {markdownTheme} from '../themes.js';

/** Format a Date as `YYYY-MM-DD` using UTC to match the webapp's `todayUTC`. */
function isoDate(d: Date): string {
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(d.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/** Human-readable label like `Wed, Mar 12 2026`. */
function humanDate(d: Date): string {
	const weekday = d.toLocaleDateString('en-US', {
		weekday: 'short',
		timeZone: 'UTC',
	});
	const month = d.toLocaleDateString('en-US', {
		month: 'short',
		timeZone: 'UTC',
	});
	const day = d.getUTCDate();
	const year = d.getUTCFullYear();
	return `${weekday}, ${month} ${day} ${year}`;
}

function isSameUTCDay(a: Date, b: Date): boolean {
	return (
		a.getUTCFullYear() === b.getUTCFullYear() &&
		a.getUTCMonth() === b.getUTCMonth() &&
		a.getUTCDate() === b.getUTCDate()
	);
}

/**
 * Side-panel view of a daily scratchpad. Renders the rendered-HTML content as
 * markdown so it reads naturally in the terminal. Exposes {@link setDate} and
 * {@link refresh} so callers can navigate days (Ctrl+[/Ctrl+]) or re-fetch
 * after the agent runs an `update_scratchpad` tool.
 */
export class ScratchpadPanel implements Component {
	private container = new Container();
	private headerText = new Text('', 0, 0);
	private bodyContainer = new Container();
	private date: Date;

	onDateChange?: (date: Date) => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private onRender: () => void,
		initialDate?: Date,
	) {
		this.date = initialDate ?? new Date();
		this.container.addChild(this.headerText);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.bodyContainer);
		void this.load();
	}

	getDate(): Date {
		return this.date;
	}

	setDate(date: Date): void {
		this.date = date;
		this.onDateChange?.(date);
		void this.load();
	}

	shiftDays(delta: number): void {
		const next = new Date(this.date);
		next.setUTCDate(next.getUTCDate() + delta);
		this.setDate(next);
	}

	async refresh(): Promise<void> {
		await this.load();
	}

	private updateHeader(state?: string): void {
		const today = isSameUTCDay(this.date, new Date());
		const marker = today ? chalk.yellow('◆') : chalk.dim('◇');
		const dateLabel = humanDate(this.date);
		const nav = chalk.dim(' · ctrl+p prev · ctrl+n next');
		const stateLabel = state ? chalk.dim(`  · ${state}`) : '';
		this.headerText.setText(
			`${marker} ${chalk.bold.white('Scratchpad')} ${chalk.dim('—')} ${chalk.white(dateLabel)}${stateLabel}${nav}`,
		);
	}

	private async load(): Promise<void> {
		this.updateHeader('loading');
		this.onRender();
		try {
			const page = await fetchPageByDate(this.baseUrl, this.apiKey, isoDate(this.date));
			const html = await fetchPageContent(this.baseUrl, this.apiKey, page.id);
			this.renderBody(html);
			this.updateHeader();
			this.onRender();
		} catch (err) {
			this.updateHeader('error');
			this.bodyContainer.clear();
			this.bodyContainer.addChild(
				new Text(
					chalk.red('Failed to load: ') +
						chalk.dim(err instanceof Error ? err.message : String(err)),
					0,
					0,
				),
			);
			this.onRender();
		}
	}

	private renderBody(html: string | null): void {
		this.bodyContainer.clear();
		const md = html ? htmlToMarkdown(html).trim() : '';
		if (md.length === 0) {
			this.bodyContainer.addChild(
				new Text(
					chalk.dim(
						'(empty — ask ') +
						chalk.white('"append X to my scratchpad"') +
						chalk.dim(' to fill it)'),
					0,
					0,
				),
			);
			return;
		}
		this.bodyContainer.addChild(new Markdown(md, 0, 0, markdownTheme));
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate?.();
	}
}
