import {visibleWidth, truncateToWidth} from '@mariozechner/pi-tui';
import type {Component} from '@mariozechner/pi-tui';
import chalk from 'chalk';

/**
 * Single-row status bar rendered below the editor.
 * Left side: incognito badge (when active).
 * Right side: first line of the below-input widget (when loaded).
 * Returns [] when neither is active (no visible space consumed).
 */
export class StatusLine implements Component {
	private _incognito = false;
	private _widget: Component | null = null;

	setIncognito(val: boolean): void {
		this._incognito = val;
	}

	setWidget(widget: Component | null): void {
		this._widget = widget;
	}

	render(width: number): string[] {
		const left = this._incognito
			? chalk.bgHex('#3a2a00').hex('#ffcc44')(' ⊘ incognito ')
			: '';

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
