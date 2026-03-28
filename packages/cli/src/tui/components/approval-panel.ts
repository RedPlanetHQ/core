import {truncateToWidth} from '@mariozechner/pi-tui';
import type {Component} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import {getToolDisplayName} from '../utils/tool-names.js';
import {loadWidgetBundle} from '../utils/widget-loader.js';

export interface PendingApproval {
	approvalId: string;
	toolCallId: string;
	toolName: string;
	input?: Record<string, unknown>;
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
	return getToolDisplayName(toolName);
}

export class ApprovalPanel implements Component {
	private pendingApprovals: PendingApproval[] = [];
	private acceptAll = false;
	private accountFrontendMap: Map<string, string>;
	private requestRender: () => void;
	private toolUIComp: Component | null = null;

	/** Called with (approved, acceptAll) when the user confirms */
	onSelect?: (approved: boolean, acceptAll: boolean) => void;

	constructor(
		accountFrontendMap: Map<string, string>,
		requestRender: () => void,
	) {
		this.accountFrontendMap = accountFrontendMap;
		this.requestRender = requestRender;
	}

	addApproval(approval: PendingApproval): void {
		this.pendingApprovals.push(approval);
		// Try loading toolUI only for the first (active) approval
		if (this.pendingApprovals.length === 1) {
			void this.tryLoadToolUI(approval);
		}
	}

	get count(): number {
		return this.pendingApprovals.length;
	}

	private async tryLoadToolUI(approval: PendingApproval): Promise<void> {
		if (approval.toolName !== 'execute_integration_action') return;
		const accountId =
			typeof approval.input?.accountId === 'string' ? approval.input.accountId : undefined;
		if (!accountId) return;
		const frontendUrl = this.accountFrontendMap.get(accountId);
		if (!frontendUrl) return;

		try {
			const mod = await loadWidgetBundle(frontendUrl);
			const toolUI = (mod as unknown as {toolUI?: {
				supported_tools: string[];
				render: (
					toolName: string,
					input: Record<string, unknown>,
					result: unknown,
					context: Record<string, unknown>,
					submitInput: (i: Record<string, unknown>) => void,
					onDecline: () => void,
				) => Promise<unknown>;
			}}).toolUI;

			const effectiveAction =
				typeof approval.input?.action === 'string' ? approval.input.action : null;
			if (!toolUI || !effectiveAction || !toolUI.supported_tools.includes(effectiveAction))
				return;

			let inputParameters: Record<string, unknown> = {};
			try {
				inputParameters = JSON.parse(approval.input?.parameters as string) as Record<string, unknown>;
			} catch {
				// use empty object
			}

			const comp = await toolUI.render(
				effectiveAction,
				inputParameters,
				null,
				{placement: 'tui'},
				() => {
					this.onSelect?.(true, this.acceptAll);
				},
				() => {
					this.onSelect?.(false, false);
				},
			);

			if (comp && typeof (comp as Component).render === 'function') {
				this.toolUIComp = comp as Component;
				this.requestRender();
			}
		} catch {
			// fall through to generic display
		}
	}

	/** Shift+Tab toggles accept-all */
	toggle(): void {
		this.acceptAll = !this.acceptAll;
	}

	confirm(approved: boolean): void {
		this.onSelect?.(approved, this.acceptAll);
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const n = this.pendingApprovals.length;

		// Header
		const zap = chalk.yellow('⚡');
		lines.push(
			truncateToWidth(
				`${zap} ${chalk.bold.white(`${n} action${n !== 1 ? 's' : ''} require${n === 1 ? 's' : ''} approval`)}`,
				width,
			),
		);
		lines.push(truncateToWidth(chalk.dim('─'.repeat(width)), width));

		// Tool list
		for (let i = 0; i < this.pendingApprovals.length; i++) {
			const a = this.pendingApprovals[i];
			const displayName = resolveDisplayName(a.toolName, a.input);
			if (i === 0) {
				lines.push(truncateToWidth(chalk.bold.white(`  ● ${displayName}`), width));
			} else {
				lines.push(truncateToWidth(chalk.dim(`  ○ ${displayName}`) + chalk.dim('  (Queued)'), width));
			}
		}

		// ToolUI or inline args for the first (active) tool
		const active = this.pendingApprovals[0];
		if (active) {
			if (this.toolUIComp) {
				lines.push('');
				for (const line of this.toolUIComp.render(width)) {
					lines.push(line);
				}
			} else if (active.input && Object.keys(active.input).length > 0) {
				lines.push('');
				try {
					const argLines = JSON.stringify(active.input, null, 2).split('\n');
					for (const line of argLines.slice(0, 8)) {
						lines.push(truncateToWidth(chalk.dim('    ' + line), width));
					}
					if (argLines.length > 8) {
						lines.push(truncateToWidth(chalk.dim(`    … +${argLines.length - 8} more lines`), width));
					}
				} catch {
					// skip
				}
			}
		}

		lines.push('');

		// Action bar
		const yKey = chalk.bold.green('y') + chalk.white(' approve all');
		const nKey = chalk.bold.red('n') + chalk.white(' decline all');
		const tabHint = this.acceptAll
			? chalk.bold.yellow('[shift+tab]') + chalk.white(' accept-all: ') + chalk.green('ON')
			: chalk.dim('[shift+tab] accept-all');
		lines.push(truncateToWidth(`  ${yKey}   ${nKey}   ${tabHint}`, width));

		return lines;
	}

	invalidate(): void {
		this.toolUIComp?.invalidate?.();
	}
}
