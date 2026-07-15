import {truncateToWidth} from '@earendil-works/pi-tui';
import type {Component} from '@earendil-works/pi-tui';
import chalk from 'chalk';

export type ContextKind = 'task' | 'scratchpad';

export interface ContextInfo {
	kind: ContextKind;
	/** Compact id shown at the start (task display-id or `YYYY-MM-DD`). */
	pill: string;
	/** Optional descriptive text (task title, day label, etc). */
	subtitle?: string;
	/** Optional hint like `ctrl+o info · ctrl+r runs`. */
	hint?: string;
}

const TASK_COLOR = chalk.cyan;
const SCRATCHPAD_COLOR = chalk.yellow;

/**
 * Single-row context line rendered directly above the editor when a task or
 * scratchpad day is active. Renders `[id] title · hint` on a colored line,
 * mirroring the editor's own top border colour that {@link ContextBar.borderColor}
 * exposes.
 */
export class ContextBar implements Component {
	private info: ContextInfo | null = null;

	setContext(info: ContextInfo | null): void {
		this.info = info;
	}

	getContext(): ContextInfo | null {
		return this.info;
	}

	static borderColor(kind: ContextKind | null): (s: string) => string {
		if (kind === 'task') return TASK_COLOR;
		if (kind === 'scratchpad') return SCRATCHPAD_COLOR;
		return chalk.gray;
	}

	render(width: number): string[] {
		if (!this.info) return [];

		const boldPill =
			this.info.kind === 'task'
				? chalk.cyan.bold(this.info.pill)
				: chalk.yellow.bold(this.info.pill);
		const id = chalk.dim('[') + boldPill + chalk.dim(']');
		const parts: string[] = [id];
		if (this.info.subtitle) parts.push(chalk.bold.white(this.info.subtitle));
		if (this.info.hint) parts.push(chalk.dim(this.info.hint));
		const line = ' ' + parts.join(chalk.dim(' · ')) + ' ';
		return [truncateToWidth(line, width)];
	}

	invalidate(): void {
		// Stateless
	}
}
