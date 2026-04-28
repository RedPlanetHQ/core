import {visibleWidth, truncateToWidth} from '@mariozechner/pi-tui';
import type {Component} from '@mariozechner/pi-tui';
import chalk from 'chalk';

export type ChatMode = 'chat' | 'newTask';

/**
 * Single-row status bar rendered below the editor.
 * Left side: incognito badge (when active).
 * Right side: first line of the below-input widget (when loaded).
 * Returns [] when neither is active (no visible space consumed).
 */
export class StatusLine implements Component {
	private _incognito = false;
	private _acceptAll = false;
	private _widget: Component | null = null;
	private _mode: ChatMode = 'chat';

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

	render(width: number): string[] {
		const parts: string[] = [];
		if (this._mode === 'newTask') {
			parts.push(chalk.bgHex('#3a3a00').hex('#ffee66')(' ⊕ NEW TASK '));
		}
		if (this._incognito) {
			parts.push(chalk.bgHex('#3a2a00').hex('#ffcc44')(' ⊘ incognito '));
		}
		if (this._acceptAll) {
			parts.push(chalk.bgHex('#1a3a1a').hex('#44cc44')(' ✓ accept all '));
		}
		const left = parts.join(' ');

		let right = '';
		if (this._widget) {
			const lines = this._widget.render(width);
			right = lines[0] ?? '';
		}

		if (!left && !right) return [];

		const leftW = visibleWidth(left);
		const rightW = visibleWidth(right);
		const gap = Math.max(1, width - leftW - rightW);
		return [truncateToWidth(left + ' '.repeat(gap) + right, width)];
	}

	invalidate(): void {
		this._widget?.invalidate?.();
	}
}
