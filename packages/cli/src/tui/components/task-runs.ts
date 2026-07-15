import {
	SelectList,
	Text,
	Spacer,
	Container,
	Loader,
	matchesKey,
	Key,
} from '@earendil-works/pi-tui';
import type {Component, TUI} from '@earendil-works/pi-tui';
import chalk from 'chalk';
import {fetchTaskRuns, type TaskRunSummary, type TaskSummary} from '../utils/stream.js';

const selectListTheme = {
	selectedPrefix: (s: string) => chalk.cyan(s),
	selectedText: (s: string) => chalk.white(s),
	description: (s: string) => chalk.dim(s),
	scrollInfo: (s: string) => chalk.dim(s),
	noMatch: (s: string) => chalk.dim(s),
};

function ageStr(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	if (diff < 60_000) return 'just now';
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

function statusDot(status: string | null): string {
	switch (status) {
		case 'completed':
			return chalk.green('●');
		case 'running':
			return chalk.blue('◐');
		case 'failed':
			return chalk.red('✗');
		case 'pending':
		default:
			return chalk.gray('○');
	}
}

/**
 * List of every conversation ("run") that belongs to a recurring task,
 * newest first. Opened via Ctrl+R when a recurring task is the active
 * conversation. Selecting a row hands the conversation id back to the caller
 * via {@link onOpenRun} so the parent can `resume(run.id)` into it.
 */
export class TaskRuns implements Component {
	private container: Container;
	private headerText: Text;
	private bodyContainer: Container;
	private list: SelectList | null = null;
	private runs: TaskRunSummary[] = [];
	private loading = false;

	onCancel?: () => void;
	onOpenRun?: (run: TaskRunSummary) => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private task: TaskSummary,
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

		this.load();
	}

	private updateHeader(): void {
		const id = this.task.displayId ? chalk.dim(`[${this.task.displayId}] `) : '';
		const title = chalk.bold.white(this.task.title || 'Untitled');
		const hint = chalk.dim('  ↑↓ navigate · Enter open run · r refresh · Esc back');
		this.headerText.setText(
			`${chalk.bold.cyan('Runs')} · ${id}${title}${hint}`,
		);
	}

	private buildItems() {
		return this.runs.map((r, idx) => {
			const label =
				`${statusDot(r.status)} ` +
				chalk.white(`Run ${this.runs.length - idx}`) +
				chalk.dim(' · ') +
				chalk.white(new Date(r.createdAt).toLocaleString());
			const description =
				chalk.dim(`${r.status ?? 'unknown'}  ·  updated ${ageStr(r.updatedAt)}`);
			return {value: r.id, label, description};
		});
	}

	private rebuildList(): void {
		this.bodyContainer.clear();
		this.list = null;

		if (this.runs.length === 0) {
			this.bodyContainer.addChild(
				new Text(chalk.dim('No runs yet.'), 1, 0),
			);
			return;
		}

		this.list = new SelectList(this.buildItems(), 18, selectListTheme);
		this.list.onCancel = () => this.onCancel?.();
		this.list.onSelect = item => {
			const run = this.runs.find(r => r.id === item.value);
			if (run) this.onOpenRun?.(run);
		};
		this.bodyContainer.addChild(this.list);
	}

	private load(): void {
		if (this.loading) return;
		this.loading = true;
		this.bodyContainer.clear();
		this.list = null;

		const loaderComp = new Loader(
			this.tui,
			s => chalk.cyan(s),
			s => chalk.dim(s),
			'Loading runs...',
		);
		loaderComp.start();
		this.bodyContainer.addChild(loaderComp);
		this.updateHeader();
		this.onRender();

		fetchTaskRuns(this.baseUrl, this.apiKey, this.task.id, 50)
			.then(runs => {
				loaderComp.stop();
				this.runs = runs;
				this.loading = false;
				this.rebuildList();
				this.onRender();
			})
			.catch((err: Error) => {
				loaderComp.stop();
				this.bodyContainer.clear();
				this.bodyContainer.addChild(
					new Text(chalk.red('Error: ') + chalk.dim(err.message), 1, 0),
				);
				this.loading = false;
				this.onRender();
			});
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.onCancel?.();
			return;
		}
		if (matchesKey(data, 'r')) {
			this.load();
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
