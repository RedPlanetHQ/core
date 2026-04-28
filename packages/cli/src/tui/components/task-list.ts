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
import {
	fetchTasks,
	isRecurringTask,
	updateTaskApi,
	type TaskSummary,
	type TaskStatusValue,
} from '../utils/stream.js';

const selectListTheme = {
	selectedPrefix: (s: string) => chalk.cyan(s),
	selectedText: (s: string) => chalk.white(s),
	description: (s: string) => chalk.dim(s),
	scrollInfo: (s: string) => chalk.dim(s),
	noMatch: (s: string) => chalk.dim(s),
};

// `recurring: true` tabs filter client-side after fetching all tasks
// (matches the webapp's pattern in home.tasks._index.tsx).
// `status: <value>` tabs filter server-side via query param.
type Tab = {
	key: string;
	status: TaskStatusValue | null;
	recurring?: boolean;
};

const TABS: Tab[] = [
	{key: 'All', status: null},
	{key: 'Todo', status: 'Todo'},
	{key: 'Waiting', status: 'Waiting'},
	{key: 'Ready', status: 'Ready'},
	{key: 'Working', status: 'Working'},
	{key: 'Review', status: 'Review'},
	{key: 'Done', status: 'Done'},
	{key: 'Recurring', status: null, recurring: true},
];

const STATUS_CYCLE: TaskStatusValue[] = [
	'Todo',
	'Waiting',
	'Ready',
	'Working',
	'Review',
	'Done',
];

const POLL_MS = 5000;

function statusDot(s: TaskStatusValue): string {
	switch (s) {
		case 'Todo':
			return chalk.gray('○');
		case 'Waiting':
			return chalk.yellow('◔');
		case 'Ready':
			return chalk.cyan('◐');
		case 'Working':
			return chalk.blue('◑');
		case 'Review':
			return chalk.magenta('◕');
		case 'Done':
			return chalk.green('●');
	}
}

function ageStr(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	if (diff < 60_000) return 'just now';
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

export class TaskList implements Component {
	private container: Container;
	private headerText: Text;
	private tabsText: Text;
	private bodyContainer: Container;
	private list: SelectList | null = null;

	private tasks: TaskSummary[] = [];
	private tabIndex = 0;
	private loading = false;
	private pollTimer: ReturnType<typeof setInterval> | null = null;

	onCancel?: () => void;
	onOpenTask?: (task: TaskSummary) => void;
	onCreateTask?: () => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private tui: TUI,
		private onRender: () => void,
	) {
		this.container = new Container();
		this.bodyContainer = new Container();
		this.headerText = new Text('', 1, 0);
		this.tabsText = new Text('', 1, 0);

		this.container.addChild(new Spacer(1));
		this.container.addChild(this.headerText);
		this.container.addChild(this.tabsText);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.bodyContainer);

		this.load();
		this.startPolling();
	}

	private startPolling(): void {
		this.pollTimer = setInterval(() => {
			if (!this.loading) this.load(true);
		}, POLL_MS);
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	private updateHeader(): void {
		this.headerText.setText(
			chalk.bold.white('Tasks') +
				chalk.dim(
					'  ←/→ tabs · ↑↓ navigate · Enter open · n new · s cycle status · r refresh · Esc close',
				),
		);

		const tabBar = TABS.map((t, i) => {
			const active = i === this.tabIndex;
			const label = ` ${t.key} `;
			return active ? chalk.bgCyan.black(label) : chalk.dim(label);
		}).join(chalk.dim('|'));
		this.tabsText.setText(tabBar);
	}

	private buildItems() {
		return this.tasks.map(t => {
			const meta: string[] = [];
			if (t.displayId) meta.push(t.displayId);
			meta.push(t.status);
			meta.push(ageStr(t.updatedAt));
			return {
				value: t.id,
				label: `${statusDot(t.status)} ${t.title}`,
				description: meta.join(' · '),
			};
		});
	}

	private applyTabFilter(tasks: TaskSummary[]): TaskSummary[] {
		const tab = TABS[this.tabIndex];
		if (tab?.recurring) return tasks.filter(isRecurringTask);
		return tasks;
	}

	private rebuildList(): void {
		this.bodyContainer.clear();
		this.list = null;

		if (this.tasks.length === 0) {
			this.bodyContainer.addChild(
				new Text(
					chalk.dim('No tasks in this view. Press n to create one.'),
					1,
					0,
				),
			);
			return;
		}

		this.list = new SelectList(this.buildItems(), 18, selectListTheme);
		this.list.onCancel = () => this.onCancel?.();
		this.list.onSelect = item => {
			const task = this.tasks.find(t => t.id === item.value);
			if (task) this.onOpenTask?.(task);
		};
		this.bodyContainer.addChild(this.list);
	}

	private load(silent = false): void {
		if (this.loading) return;
		this.loading = true;

		const tab = TABS[this.tabIndex];
		const status = tab?.status ?? undefined;

		if (!silent) {
			this.bodyContainer.clear();
			this.list = null;

			const loaderComp = new Loader(
				this.tui,
				s => chalk.cyan(s),
				s => chalk.dim(s),
				'Loading tasks...',
			);
			loaderComp.start();
			this.bodyContainer.addChild(loaderComp);
			this.updateHeader();
			this.onRender();

			fetchTasks(this.baseUrl, this.apiKey, status)
				.then(tasks => {
					loaderComp.stop();
					this.tasks = this.applyTabFilter(tasks);
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
		} else {
			fetchTasks(this.baseUrl, this.apiKey, status)
				.then(tasks => {
					this.tasks = this.applyTabFilter(tasks);
					this.loading = false;
					this.rebuildList();
					this.onRender();
				})
				.catch(() => {
					this.loading = false;
				});
		}
	}

	private cycleStatusOnSelected(): void {
		const selected = this.list?.getSelectedItem?.();
		if (!selected) return;
		const task = this.tasks.find(t => t.id === selected.value);
		if (!task) return;
		const idx = STATUS_CYCLE.indexOf(task.status as TaskStatusValue);
		const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
		updateTaskApi(this.baseUrl, this.apiKey, task.id, {status: next})
			.then(() => this.load(true))
			.catch(() => {
				/* swallow; will re-poll */
			});
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.onCancel?.();
			return;
		}
		if (matchesKey(data, Key.left) || matchesKey(data, 'h')) {
			this.tabIndex = (this.tabIndex - 1 + TABS.length) % TABS.length;
			this.load();
			return;
		}
		if (matchesKey(data, Key.right) || matchesKey(data, 'l')) {
			this.tabIndex = (this.tabIndex + 1) % TABS.length;
			this.load();
			return;
		}
		if (matchesKey(data, 'r')) {
			this.load();
			return;
		}
		if (matchesKey(data, 'n')) {
			this.onCreateTask?.();
			return;
		}
		if (matchesKey(data, 's')) {
			this.cycleStatusOnSelected();
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

	dispose(): void {
		this.stopPolling();
	}
}
