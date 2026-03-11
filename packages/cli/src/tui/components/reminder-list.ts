import {
	SelectList,
	Text,
	Spacer,
	Container,
	Loader,
	matchesKey,
	Key,
} from '@mariozechner/pi-tui';
import type {Component, TUI} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import {fetchReminders} from '../utils/stream.js';
import type {ReminderSummary} from '../utils/stream.js';

const selectListTheme = {
	selectedPrefix: (s: string) => chalk.cyan(s),
	selectedText: (s: string) => chalk.white(s),
	description: (s: string) => chalk.dim(s),
	scrollInfo: (s: string) => chalk.dim(s),
	noMatch: (s: string) => chalk.dim(s),
};

const PAGE_SIZE = 25;
const LOAD_MORE_THRESHOLD = 3;
type FilterMode = 'all' | 'active' | 'inactive';

function formatSchedule(
	schedule: string,
	maxOccurrences: number | null,
): string {
	const freq = schedule.match(/FREQ=(\w+)/)?.[1] ?? 'DAILY';
	const hour = schedule.match(/BYHOUR=(\d+)/)?.[1];
	const minute = parseInt(schedule.match(/BYMINUTE=(\d+)/)?.[1] ?? '0');
	const days = schedule.match(/BYDAY=([A-Z,]+)/)?.[1];
	const interval = parseInt(schedule.match(/INTERVAL=(\d+)/)?.[1] ?? '1');
	const dayNames: Record<string, string> = {
		MO: 'Mon',
		TU: 'Tue',
		WE: 'Wed',
		TH: 'Thu',
		FR: 'Fri',
		SA: 'Sat',
		SU: 'Sun',
	};

	let timeStr = '';
	if (hour !== undefined) {
		const h = parseInt(hour);
		const ampm = h >= 12 ? 'PM' : 'AM';
		const h12 = h % 12 || 12;
		timeStr =
			minute > 0
				? `${h12}:${minute.toString().padStart(2, '0')}${ampm}`
				: `${h12}${ampm}`;
	}

	if (maxOccurrences === 1) return timeStr ? `Once at ${timeStr}` : 'Once';

	let result = '';
	if (freq === 'MINUTELY')
		result = interval > 1 ? `Every ${interval} min` : 'Every minute';
	else if (freq === 'HOURLY')
		result = interval > 1 ? `Every ${interval} hours` : 'Hourly';
	else if (freq === 'DAILY')
		result = days
			? days
					.split(',')
					.map(d => dayNames[d] ?? d)
					.join(', ')
			: interval > 1
			? `Every ${interval} days`
			: 'Daily';
	else if (freq === 'WEEKLY')
		result = interval > 1 ? `Every ${interval} weeks` : 'Weekly';
	if (timeStr) result += ` at ${timeStr}`;
	return result || schedule;
}

function formatRelative(dateStr: string): string {
	const diff = new Date(dateStr).getTime() - Date.now();
	const abs = Math.abs(diff);
	const future = diff > 0;
	const str =
		abs < 3600000
			? `${Math.floor(abs / 60000)}m`
			: abs < 86400000
			? `${Math.floor(abs / 3600000)}h`
			: `${Math.floor(abs / 86400000)}d`;
	return future ? `in ${str}` : `${str} ago`;
}

export class ReminderList implements Component {
	private container: Container;
	private headerText: Text;
	private bodyContainer: Container;
	private list: SelectList | null = null;

	private reminders: ReminderSummary[] = [];
	private cursor: string | null = null;
	private hasMore = false;
	private loading = false;
	private filter: FilterMode = 'all';
	private emptyText: Text | null = null;

	onCancel?: () => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private tui: TUI,
		private onRender: () => void,
	) {
		this.container = new Container();
		this.bodyContainer = new Container();
		this.headerText = new Text('', 1, 0);

		this.container.addChild(new Spacer(1));
		this.container.addChild(this.headerText);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.bodyContainer);

		this.load(true);
	}

	private filterLabel(): string {
		if (this.filter === 'active') return chalk.green('[Active]');
		if (this.filter === 'inactive') return chalk.dim('[Inactive]');
		return chalk.dim('[All]');
	}

	private updateHeader(): void {
		this.headerText.setText(
			chalk.bold.white('Reminders') +
				'  ' +
				this.filterLabel() +
				chalk.dim('  ↑↓ navigate · f filter · Esc close'),
		);
	}

	private buildItems() {
		return this.reminders.map(r => {
			const meta: string[] = [
				formatSchedule(r.schedule, r.maxOccurrences),
				r.channel,
			];
			if (r.maxOccurrences !== null)
				meta.push(`${r.occurrenceCount}/${r.maxOccurrences}`);
			if (r.isActive && r.nextRunAt)
				meta.push(`next: ${formatRelative(r.nextRunAt)}`);
			return {
				value: r.id,
				label: (r.isActive ? chalk.green('● ') : chalk.dim('○ ')) + r.text,
				description: meta.join(' · '),
			};
		});
	}

	private rebuildList(): void {
		if (this.list) {
			try {
				this.bodyContainer.removeChild(this.list);
			} catch {
				/* ignore */
			}
			this.list = null;
		}

		if (this.emptyText) {
			try {
				this.bodyContainer.removeChild(this.emptyText);
			} catch {
				/* ignore */
			}
			this.emptyText = null;
		}

		if (this.reminders.length === 0) {
			this.emptyText = new Text(chalk.dim('No reminders found.'), 1, 0);
			this.bodyContainer.addChild(this.emptyText);
			return;
		}

		this.list = new SelectList(this.buildItems(), 15, selectListTheme);
		this.list.onCancel = () => this.onCancel?.();
		this.list.onSelectionChange = item => {
			const idx = this.reminders.findIndex(r => r.id === item.value);
			if (
				this.hasMore &&
				!this.loading &&
				idx >= this.reminders.length - LOAD_MORE_THRESHOLD
			) {
				this.load(false);
			}
		};
		this.bodyContainer.addChild(this.list);
	}

	private load(reset: boolean): void {
		if (this.loading) return;
		this.loading = true;

		const isActive =
			this.filter === 'active'
				? ('true' as const)
				: this.filter === 'inactive'
				? ('false' as const)
				: undefined;

		if (reset) {
			this.reminders = [];
			this.cursor = null;
			if (this.list) {
				try {
					this.bodyContainer.removeChild(this.list);
				} catch {
					/* ignore */
				}
				this.list = null;
			}

			const loaderComp = new Loader(
				this.tui,
				s => chalk.cyan(s),
				s => chalk.dim(s),
				'Loading reminders...',
			);
			loaderComp.start();
			this.bodyContainer.addChild(loaderComp);
			this.updateHeader();
			this.onRender();

			fetchReminders(this.baseUrl, this.apiKey, undefined, isActive, PAGE_SIZE)
				.then(result => {
					loaderComp.stop();
					try {
						this.bodyContainer.removeChild(loaderComp);
					} catch {
						/* ignore */
					}
					this.reminders = result.reminders;
					this.hasMore = result.hasMore;
					this.cursor = result.nextCursor;
					this.loading = false;
					this.rebuildList();
					this.onRender();
				})
				.catch((err: Error) => {
					loaderComp.stop();
					try {
						this.bodyContainer.removeChild(loaderComp);
					} catch {
						/* ignore */
					}
					this.bodyContainer.addChild(
						new Text(chalk.red('Error: ') + chalk.dim(err.message), 1, 0),
					);
					this.loading = false;
					this.onRender();
				});
		} else {
			fetchReminders(
				this.baseUrl,
				this.apiKey,
				this.cursor ?? undefined,
				isActive,
				PAGE_SIZE,
			)
				.then(result => {
					this.reminders = [...this.reminders, ...result.reminders];
					this.hasMore = result.hasMore;
					this.cursor = result.nextCursor;
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
		if (matchesKey(data, Key.escape)) {
			this.onCancel?.();
			return;
		}

		if (matchesKey(data, 'f')) {
			this.filter =
				this.filter === 'all'
					? 'active'
					: this.filter === 'active'
					? 'inactive'
					: 'all';
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
