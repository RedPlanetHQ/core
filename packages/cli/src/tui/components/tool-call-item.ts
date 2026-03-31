import {truncateToWidth} from '@mariozechner/pi-tui';
import type {Component} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import {getToolDisplayName} from '../utils/tool-names.js';
import type {OutputPart} from '../utils/stream.js';

const PREVIEW_LINES = 3;

function toResultString(value: unknown): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function toSingleLine(str: string): string {
	return str.replace(/[\r\n\t]+/g, ' ').trim();
}

function argSummaryFromInput(
	input: Record<string, unknown> | undefined,
	raw: string,
): string {
	if (input) {
		try {
			const firstVal = Object.values(input)[0];
			const str = toSingleLine(
				typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal ?? ''),
			);
			return str.length > 60 ? str.slice(0, 60) + '\u2026' : str;
		} catch {}
	}

	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const firstVal = Object.values(parsed)[0];
		const str = toSingleLine(
			typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal ?? ''),
		);
		return str.length > 60 ? str.slice(0, 60) + '\u2026' : str;
	} catch {
		return toSingleLine(raw).slice(0, 60);
	}
}

const toTitleCase = (s: string) =>
	s
		.split('_')
		.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
		.join(' ');

function resolveDisplayName(toolName: string, input?: Record<string, unknown>): string {
	if (toolName === 'execute_integration_action' && typeof input?.action === 'string') {
		return toTitleCase(input.action);
	}
	if (toolName === 'get_integration_actions' && typeof input?.query === 'string') {
		return input.query;
	}
	return getToolDisplayName(toolName);
}

export class ToolCallItem implements Component {
	private toolName: string;
	private displayName: string;
	private args: string = '';
	private argSummary: string = '';
	// result = the orchestrator's final text summary (for container tools)
	// or the raw tool output (for leaf tools)
	private result: string = '';
	private children: ToolCallItem[] = [];
	private childrenByCallId = new Map<string, ToolCallItem>();
	public isExpanded = false;
	public isDone = false;

	constructor(toolName: string) {
		this.toolName = toolName;
		this.displayName = getToolDisplayName(toolName);
	}

	appendArgsDelta(delta: string): void {
		this.args += delta;
	}

	setArgs(args: Record<string, unknown>): void {
		this.args = JSON.stringify(args);
		this.displayName = resolveDisplayName(this.toolName, args);
	}

	/**
	 * Mark known children done by their call IDs.
	 * Used when data-tool-agent events have toolCalls:[] but toolResults with results
	 * for children that were registered in an earlier snapshot (post-approval pattern).
	 */
	markChildrenDoneByIds(resultMap: Map<string, unknown>): void {
		for (const [callId, result] of resultMap) {
			const child = this.childrenByCallId.get(callId);
			if (child && !child.isDone) {
				child.isDone = true;
				child.result = toResultString(result);
			}
		}
	}

	/** Called on each tool-output-available — updates nested children in real-time */
	updateFromOutputParts(parts: OutputPart[]): void {
		for (const part of parts) {
			// Capture the orchestrator's final text summary
			if (
				part.type === 'text' &&
				(part as any).state === 'done' &&
				typeof part.text === 'string'
			) {
				this.result = part.text;
				continue;
			}

			// Skip non-tool parts (step-start, text without state=done, etc.)
			if (!part.type.startsWith('tool-') || !part.toolCallId) continue;

			const toolName = part.type.slice('tool-'.length); // strip "tool-" prefix
			const callId = part.toolCallId;

			let child = this.childrenByCallId.get(callId);
			if (!child) {
				child = new ToolCallItem(toolName);
				this.children.push(child);
				this.childrenByCallId.set(callId, child);
			}

			if (part.input) {
				child.args = JSON.stringify(part.input);
				child.argSummary = argSummaryFromInput(part.input, child.args);
				child.displayName = resolveDisplayName(toolName, part.input);
			}

			if (part.state === 'output-available' && !child.isDone) {
				child.isDone = true;
				child.result = toResultString(part.output);
			}
		}
	}

	/**
	 * Returns not-done children — these are nested tools still waiting
	 * (in-progress or approval-requested) at the time of an approval event.
	 * Mirrors webapp's findPendingApprovals expansion of agent-take_action.
	 */
	getPendingChildren(): Array<{toolName: string; displayName: string; input: Record<string, unknown>}> {
		return this.children
			.filter(c => !c.isDone)
			.map(c => ({
				toolName: c.toolName,
				displayName: c.displayName,
				input: c.parsedArgs(),
			}));
	}

	/**
	 * TUI equivalent of webapp's cachedNestedPartsRef lookup.
	 * Resumed streams send only toolResults, so this resolves a Mastra call ID
	 * (e.g. "call k23...") to the child that was cached from the first stream.
	 */
	getChildInfo(callId: string): {toolName: string; input: Record<string, unknown>} | undefined {
		const child = this.childrenByCallId.get(callId);
		if (!child) return undefined;
		return {toolName: child.toolName, input: child.parsedArgs()};
	}

	parsedArgs(): Record<string, unknown> {
		try {
			return JSON.parse(this.args) as Record<string, unknown>;
		} catch {
			return {};
		}
	}

	addChild(child: ToolCallItem): void {
		this.children.push(child);
	}

	setDone(result?: unknown): void {
		this.isDone = true;
		this.isExpanded = false;
		this.argSummary = argSummaryFromInput(undefined, this.args);

		// For leaf tools (no children), store raw result
		if (result !== undefined && this.children.length === 0) {
			this.result = toResultString(result);
		}
	}

	toggleExpand(): void {
		this.isExpanded = !this.isExpanded;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return this._render(width, 0);
	}

	_render(width: number, depth: number): string[] {
		const indent = '  '.repeat(depth);
		const lines: string[] = [];

		const dot = this.isDone ? chalk.green('●') : chalk.yellow('◌');
		let header: string;
		if (this.isDone) {
			header = `${indent}${dot} ${chalk.bold(this.displayName)}${this.argSummary ? chalk.dim('(' + this.argSummary + ')') : ''}`;
		} else if (!this.isExpanded && this.children.length > 0) {
			const activeChild =
				[...this.children].reverse().find(c => !c.isDone) ??
				this.children[this.children.length - 1];
			const childDot = activeChild.isDone ? chalk.green('●') : chalk.yellow('◌');
			header = `${indent}${dot} ${chalk.bold(this.displayName)} ${chalk.dim('›')} ${childDot} ${chalk.dim(activeChild.displayName)}`;
		} else {
			header = `${indent}${dot} ${chalk.bold(this.displayName)} ${chalk.dim('(running...)')}`;
		}

		lines.push(truncateToWidth(header, width));

		const hasChildren = this.children.length > 0;
		const isRoot = depth === 0;

		// ── Still running: show children inline if not collapsed ──────────────
		if (!this.isDone && hasChildren) {
			if (!this.isExpanded) return lines;
			for (const child of this.children) {
				for (const line of child._render(width, depth + 1)) {
					lines.push(line);
				}
			}

			return lines;
		}

		if (!this.isDone) return lines;

		// ── Done + expanded: show nested tools + full result text ─────────────
		if (this.isExpanded) {
			if (hasChildren) {
				for (const child of this.children) {
					for (const line of child._render(width, depth + 1)) {
						lines.push(line);
					}
				}
			} else if (this.args) {
				lines.push(truncateToWidth(chalk.dim(indent + '  args:'), width));
				try {
					const parsed = JSON.parse(this.args) as Record<string, unknown>;
					for (const line of JSON.stringify(parsed, null, 2).split('\n')) {
						lines.push(
							truncateToWidth(indent + '    ' + chalk.dim(line), width),
						);
					}
				} catch {
					for (const line of this.args.split('\n')) {
						lines.push(
							truncateToWidth(indent + '    ' + chalk.dim(line), width),
						);
					}
				}
			}

			if (this.result) {
				lines.push(truncateToWidth(chalk.dim(indent + '  result:'), width));
				for (const line of this.result.split('\n')) {
					lines.push(truncateToWidth(indent + '    ' + chalk.dim(line), width));
				}
			}

			if (isRoot) {
				lines.push(
					truncateToWidth(
						chalk.dim(indent + '  \u2514\u2500 ctrl+o to collapse'),
						width,
					),
				);
			}
			return lines;
		}

		// ── Done + collapsed: show result preview only (children hidden) ──────
		if (this.result) {
			const resultLines = this.result
				.split('\n')
				.filter((l) => l.trim().length > 0);
			for (const line of resultLines.slice(0, PREVIEW_LINES)) {
				lines.push(
					truncateToWidth(indent + '  \u2502 ' + chalk.dim(line), width),
				);
			}

			if (isRoot) {
				const extra = resultLines.length - PREVIEW_LINES;
				lines.push(
					truncateToWidth(
						chalk.dim(
							extra > 0
								? `${indent}  \u2514\u2500 +${extra} lines (ctrl+o to expand)`
								: `${indent}  \u2514\u2500 ctrl+o to expand`,
						),
						width,
					),
				);
			}
		} else if (isRoot) {
			lines.push(
				truncateToWidth(
					chalk.dim(indent + '  \u2514\u2500 ctrl+o to expand'),
					width,
				),
			);
		}

		return lines;
	}
}
