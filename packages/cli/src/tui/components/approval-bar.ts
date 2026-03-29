import {truncateToWidth} from '@mariozechner/pi-tui';
import type {Component} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import {getToolDisplayName} from '../utils/tool-names.js';

export class ApprovalBar implements Component {
	private acceptAll = false;
	private displayName: string;

	/** Called with (approved, acceptAll) when the user confirms */
	onSelect?: (approved: boolean, acceptAll: boolean) => void;

	constructor(toolName: string) {
		this.displayName = getToolDisplayName(toolName);
	}

	/** Shift+Tab toggles between approve and accept-all */
	toggle(): void {
		this.acceptAll = !this.acceptAll;
	}

	confirm(): void {
		this.onSelect?.(true, this.acceptAll);
	}

	render(width: number): string[] {
		const arrows = chalk.bold.yellow('►► ');
		const action = this.acceptAll
			? chalk.bold.white('accept all')
			: chalk.bold.white('approve');
		const hint = this.acceptAll
			? chalk.dim(' (shift+tab to disable) · ')
			: chalk.dim(' (shift+tab for accept all) · ');
		const context = chalk.dim(this.displayName);
		return [truncateToWidth(arrows + action + hint + context, width)];
	}

	invalidate(): void {}
}
