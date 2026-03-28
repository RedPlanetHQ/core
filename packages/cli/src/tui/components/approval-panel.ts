import {truncateToWidth} from '@mariozechner/pi-tui';
import type {Component} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import {getToolDisplayName} from '../utils/tool-names.js';
import {loadIntegrationBundle} from '../utils/integration-loader.js';

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

// 0 = Yes, 1 = Yes allow all, 2 = No
const OPTIONS = [
	{label: 'Yes'},
	{label: 'Yes, allow all during this session', hint: '(shift+tab)'},
	{label: 'No'},
] as const;

export class ApprovalPanel implements Component {
	private pendingApprovals: PendingApproval[] = [];
	private selectedOption = 0; // 0=Yes, 1=Yes allow all, 2=No
	private accountFrontendMap: Map<string, string>;
	private requestRender: () => void;
	private toolUIComp: Component | null = null;

	/** Called with (approved, acceptAll) when user confirms */
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
			const {toolUI} = await loadIntegrationBundle(frontendUrl);
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
				() => this.confirm(),
				() => this.confirm(2),
			);

			if (comp && typeof comp.render === 'function') {
				this.toolUIComp = comp;
				this.requestRender();
			}
		} catch {
			// fall through to generic display
		}
	}

	/** Move selection up */
	moveUp(): void {
		this.selectedOption = (this.selectedOption + OPTIONS.length - 1) % OPTIONS.length;
	}

	/** Move selection down */
	moveDown(): void {
		this.selectedOption = (this.selectedOption + 1) % OPTIONS.length;
	}

	/** Shift+Tab → jump straight to "Yes, allow all" */
	selectAllowAll(): void {
		this.selectedOption = 1;
	}

	/** Confirm current selection, or pass explicit index */
	confirm(optionIndex?: number): void {
		const idx = optionIndex ?? this.selectedOption;
		if (idx === 0) {
			this.onSelect?.(true, false);
		} else if (idx === 1) {
			this.onSelect?.(true, true);
		} else {
			this.onSelect?.(false, false);
		}
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const active = this.pendingApprovals[0];
		const n = this.pendingApprovals.length;

		if (!active) return lines;

		const displayName = resolveDisplayName(active.toolName, active.input);

		// ── Title (bold tool name) ────────────────────────────────────────────
		lines.push(truncateToWidth(chalk.bold.white(displayName), width));

		// Sub-title: queued count if >1
		if (n > 1) {
			const queued = this.pendingApprovals
				.slice(1)
				.map(a => resolveDisplayName(a.toolName, a.input))
				.join(', ');
			lines.push(
				truncateToWidth(chalk.dim(`+${n - 1} queued: ${queued}`), width),
			);
		}

		lines.push('');

		// ── Content: toolUI or args preview ──────────────────────────────────
		if (this.toolUIComp) {
			for (const line of this.toolUIComp.render(width)) {
				lines.push(line);
			}
		} else {
			const argsToShow = buildArgsPreview(active.toolName, active.input);
			if (argsToShow) {
				const argLines = argsToShow.split('\n');
				for (const line of argLines) {
					lines.push(truncateToWidth(chalk.dim(line), width));
				}
				lines.push('');
			}
		}

		// ── Question ─────────────────────────────────────────────────────────
		lines.push(
			truncateToWidth(
				`Do you want to run ${chalk.bold(displayName)}?`,
				width,
			),
		);

		// ── Options ──────────────────────────────────────────────────────────
		for (let i = 0; i < OPTIONS.length; i++) {
			const opt = OPTIONS[i];
			const isSelected = i === this.selectedOption;
			const arrow = isSelected ? chalk.green('\u203a') : ' ';
			const num = chalk.dim(`${i + 1}.`);
			const label = isSelected ? chalk.green(opt.label) : opt.label;
			const hint = 'hint' in opt ? chalk.dim(` ${opt.hint}`) : '';
			lines.push(truncateToWidth(`${arrow} ${num} ${label}${hint}`, width));
		}

		lines.push('');
		lines.push(truncateToWidth(chalk.dim('Esc to cancel \xb7 \u2191\u2193 to navigate \xb7 enter to confirm'), width));

		return lines;
	}

	invalidate(): void {
		this.toolUIComp?.invalidate?.();
	}
}

// Build a concise args preview string for the active tool
function buildArgsPreview(toolName: string, input?: Record<string, unknown>): string | null {
	if (!input) return null;

	// For integration actions, show the parsed parameters
	if (toolName === 'execute_integration_action') {
		const params: Record<string, unknown> = {};
		if (typeof input.action === 'string') params.action = input.action;
		if (typeof input.parameters === 'string') {
			try {
				const parsed = JSON.parse(input.parameters) as Record<string, unknown>;
				Object.assign(params, parsed);
			} catch {
				// keep raw
			}
		}
		if (Object.keys(params).length === 0) return null;
		return JSON.stringify(params, null, 2);
	}

	// Generic: show full input, max 10 lines
	const keys = Object.keys(input);
	if (keys.length === 0) return null;
	const lines = JSON.stringify(input, null, 2).split('\n');
	if (lines.length > 10) {
		return lines.slice(0, 10).join('\n') + `\n… +${lines.length - 10} more lines`;
	}
	return lines.join('\n');
}
