import {
	visibleWidth,
	truncateToWidth,
	matchesKey,
	Key,
} from '@earendil-works/pi-tui';
import type {Component, Focusable} from '@earendil-works/pi-tui';
import chalk from 'chalk';
import {
	fetchTasks,
	fetchGateways,
	fetchInboxCount,
} from '../utils/stream.js';

export type ChatMode = 'chat' | 'newTask';
export type StatusZone = 'tasks' | 'gateways' | 'catchup';

const ZONE_ORDER: StatusZone[] = ['tasks', 'gateways', 'catchup'];

const POLL_MS = 15_000;

/**
 * Compact status bar under the editor. Two rows:
 *
 *   Row 1 · badges + tasks chip on the left, below-input widget + G chip on the right
 *   Row 2 · catchup chip on the right (only when there's something to catch up on)
 *
 * When focused, ←/→ cycle through the three zones (tasks · gateways · catchup)
 * and the active zone is drawn with a background color. Enter/Space activates
 * it, Esc/↑ releases focus back to the caller via {@link onBlur}.
 */
export class StatusLine implements Component, Focusable {
	focused = false;

	private _incognito = false;
	private _acceptAll = false;
	private _widget: Component | null = null;
	private _mode: ChatMode = 'chat';

	private waitingCount = 0;
	private reviewCount = 0;
	private workingCount = 0;
	private gatewayCount = 0;
	private catchupCount = 0;

	private zone: StatusZone = 'tasks';
	private pollTimer: ReturnType<typeof setInterval> | null = null;

	onActivate?: (zone: StatusZone) => void;
	onBlur?: () => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private onChange: () => void,
	) {
		void this.refresh();
		this.pollTimer = setInterval(() => void this.refresh(), POLL_MS);
	}

	dispose(): void {
		if (this.pollTimer) clearInterval(this.pollTimer);
		this.pollTimer = null;
	}

	setIncognito(val: boolean): void {
		this._incognito = val;
	}

	setAcceptAll(val: boolean): void {
		this._acceptAll = val;
	}

	setWidget(widget: Component | null): void {
		this._widget = widget;
	}

	setMode(val: ChatMode): void {
		if (this._mode === val) return;
		this._mode = val;
	}

	getSelectedZone(): StatusZone {
		return this.zone;
	}

	setSelectedZone(zone: StatusZone): void {
		this.zone = zone;
		this.onChange();
	}

	private async refresh(): Promise<void> {
		try {
			const [waiting, review, working, gateways, catchupCount] = await Promise.all([
				fetchTasks(this.baseUrl, this.apiKey, 'Waiting'),
				fetchTasks(this.baseUrl, this.apiKey, 'Review'),
				fetchTasks(this.baseUrl, this.apiKey, 'Working'),
				fetchGateways(this.baseUrl, this.apiKey),
				fetchInboxCount(this.baseUrl, this.apiKey),
			]);
			this.waitingCount = waiting.length;
			this.reviewCount = review.length;
			this.workingCount = working.length;
			this.gatewayCount = gateways.filter(g => g.status === 'CONNECTED').length;
			this.catchupCount = catchupCount;
			this.onChange();
		} catch {
			// swallow — polling will retry
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.up)) {
			this.onBlur?.();
			return;
		}
		if (matchesKey(data, Key.right)) {
			const i = ZONE_ORDER.indexOf(this.zone);
			this.zone = ZONE_ORDER[(i + 1) % ZONE_ORDER.length];
			this.onChange();
			return;
		}
		if (matchesKey(data, Key.left)) {
			const i = ZONE_ORDER.indexOf(this.zone);
			this.zone = ZONE_ORDER[(i - 1 + ZONE_ORDER.length) % ZONE_ORDER.length];
			this.onChange();
			return;
		}
		if (data === '\r' || data === '\n' || data === ' ') {
			this.onActivate?.(this.zone);
			return;
		}
	}

	private highlight(zone: StatusZone, text: string): string {
		if (!this.focused || this.zone !== zone) return text;
		// Selected zone gets a solid dark background so it stands out without
		// shifting layout width.
		return chalk.bgHex('#3a3a3a').white(text);
	}

	private tasksChip(): string {
		const bits: string[] = [];
		if (this.waitingCount > 0)
			bits.push(chalk.yellow(`W${this.waitingCount}`));
		if (this.reviewCount > 0)
			bits.push(chalk.magenta(`R${this.reviewCount}`));
		if (this.workingCount > 0)
			bits.push(chalk.blue(`P${this.workingCount}`));
		const body = bits.length > 0 ? bits.join(chalk.dim('·')) : chalk.dim('0');
		return this.highlight('tasks', ' ' + chalk.bold.white('T ') + body + ' ');
	}

	private gatewaysChip(): string {
		const body =
			this.gatewayCount > 0
				? chalk.green(String(this.gatewayCount))
				: chalk.dim('0');
		return this.highlight('gateways', ' ' + chalk.bold.white('G ') + body + ' ');
	}

	private catchupChip(): string {
		if (this.catchupCount === 0) return '';
		const body =
			chalk.cyan(String(this.catchupCount)) +
			chalk.white(' to review') +
			chalk.dim('  · /catchup');
		return this.highlight(
			'catchup',
			' ' + chalk.bold.white('C ') + body + ' ',
		);
	}

	private badges(): string {
		const parts: string[] = [];
		if (this._mode === 'newTask')
			parts.push(chalk.bgHex('#3a3a00').hex('#ffee66')(' + NEW TASK '));
		if (this._incognito)
			parts.push(chalk.bgHex('#3a2a00').hex('#ffcc44')(' ⊘ incognito '));
		if (this._acceptAll)
			parts.push(chalk.bgHex('#1a3a1a').hex('#44cc44')(' ✓ accept all '));
		return parts.join(' ');
	}

	render(width: number): string[] {
		const rows: string[] = [];

		// Row 1: badges + tasks on the left, widget line + G chip on the right
		const left = [this.badges(), this.tasksChip()].filter(Boolean).join(' ');
		let widgetLine = '';
		if (this._widget) {
			const lines = this._widget.render(width);
			widgetLine = lines[0] ?? '';
		}
		const right = [widgetLine, this.gatewaysChip()].filter(Boolean).join(' ');

		const leftW = visibleWidth(left);
		const rightW = visibleWidth(right);
		const gap = Math.max(1, width - leftW - rightW);
		rows.push(truncateToWidth(left + ' '.repeat(gap) + right, width));

		// Row 2: catchup chip on the right (only when there is catchup or the
		// zone is currently focused, so the user can still see the highlight
		// even at zero).
		const catchupText = this.catchupChip();
		const showCatchup =
			catchupText.length > 0 || (this.focused && this.zone === 'catchup');
		if (showCatchup) {
			const chip =
				catchupText ||
				this.highlight(
					'catchup',
					' ' + chalk.bold.white('C ') + chalk.dim('0') + ' ',
				);
			const cw = visibleWidth(chip);
			const pad = Math.max(0, width - cw);
			rows.push(truncateToWidth(' '.repeat(pad) + chip, width));
		}

		if (this.focused) {
			rows.push(
				chalk.dim('  ←/→ zone · Enter open · Esc/↑ back'),
			);
		}

		return rows;
	}

	invalidate(): void {
		this._widget?.invalidate?.();
	}
}
