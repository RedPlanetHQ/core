import {
	SelectList,
	Text,
	Markdown,
	Spacer,
	Container,
	Loader,
	matchesKey,
	Key,
} from '@mariozechner/pi-tui';
import type {Component, TUI} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import {
	fetchTaskDetail,
	updateTaskApi,
	type TaskDetail as TaskDetailData,
	type TaskStatusValue,
} from '../utils/stream.js';
import {htmlToMarkdown} from '../utils/html-to-md.js';
import {markdownTheme} from '../themes.js';

const selectListTheme = {
	selectedPrefix: (s: string) => chalk.cyan(s),
	selectedText: (s: string) => chalk.white(s),
	description: (s: string) => chalk.dim(s),
	scrollInfo: (s: string) => chalk.dim(s),
	noMatch: (s: string) => chalk.dim(s),
};

const STATUS_CYCLE: TaskStatusValue[] = [
	'Todo',
	'Waiting',
	'Ready',
	'Working',
	'Review',
	'Done',
];

export class TaskDetail implements Component {
	private container: Container;
	private headerText: Text;
	private bodyContainer: Container;
	private convList: SelectList | null = null;
	private detail: TaskDetailData | null = null;
	private conversationIds: string[];

	onCancel?: () => void;
	onOpenConversation?: (conversationId: string) => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private taskId: string,
		initialConversationIds: string[],
		private tui: TUI,
		private onRender: () => void,
	) {
		this.container = new Container();
		this.bodyContainer = new Container();
		this.headerText = new Text('', 1, 0);
		this.conversationIds = initialConversationIds ?? [];

		this.container.addChild(new Spacer(1));
		this.container.addChild(this.headerText);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.bodyContainer);

		this.load();
	}

	private updateHeader(): void {
		const t = this.detail;
		const title = t?.title ?? 'Loading…';
		const id = t?.displayId ? chalk.dim(`[${t.displayId}] `) : '';
		const status = t ? chalk.cyan(`(${t.status})`) : '';
		this.headerText.setText(
			chalk.bold.white(title) +
				' ' +
				id +
				status +
				chalk.dim('   s cycle status · o open conversation · Esc back'),
		);
	}

	private renderBody(): void {
		this.bodyContainer.clear();
		this.convList = null;

		const t = this.detail;
		if (!t) return;

		const descMd = htmlToMarkdown(t.description);
		if (descMd) {
			this.bodyContainer.addChild(new Markdown(descMd, 1, 0, markdownTheme));
		} else {
			this.bodyContainer.addChild(
				new Text(chalk.dim('(no description)'), 1, 0),
			);
		}
		this.bodyContainer.addChild(new Spacer(1));
		this.bodyContainer.addChild(new Text(chalk.bold('Conversations'), 1, 0));
		this.bodyContainer.addChild(new Spacer(1));

		if (this.conversationIds.length === 0) {
			this.bodyContainer.addChild(
				new Text(chalk.dim('No conversations yet.'), 1, 0),
			);
			return;
		}

		this.convList = new SelectList(
			this.conversationIds.map((id, i) => ({
				value: id,
				label: `Conversation ${i + 1}`,
				description: id,
			})),
			10,
			selectListTheme,
		);
		this.convList.onCancel = () => this.onCancel?.();
		this.convList.onSelect = item => {
			this.onOpenConversation?.(String(item.value));
		};
		this.bodyContainer.addChild(this.convList);
	}

	private load(): void {
		this.bodyContainer.clear();
		const loaderComp = new Loader(
			this.tui,
			s => chalk.cyan(s),
			s => chalk.dim(s),
			'Loading task...',
		);
		loaderComp.start();
		this.bodyContainer.addChild(loaderComp);
		this.updateHeader();
		this.onRender();

		fetchTaskDetail(this.baseUrl, this.apiKey, this.taskId)
			.then(detail => {
				loaderComp.stop();
				this.detail = detail;
				this.updateHeader();
				this.renderBody();
				this.onRender();
			})
			.catch((err: Error) => {
				loaderComp.stop();
				this.bodyContainer.clear();
				this.bodyContainer.addChild(
					new Text(chalk.red('Error: ') + chalk.dim(err.message), 1, 0),
				);
				this.onRender();
			});
	}

	private cycleStatus(): void {
		if (!this.detail) return;
		const idx = STATUS_CYCLE.indexOf(this.detail.status as TaskStatusValue);
		const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
		updateTaskApi(this.baseUrl, this.apiKey, this.taskId, {status: next})
			.then(() => {
				if (this.detail) this.detail.status = next;
				this.updateHeader();
				this.onRender();
			})
			.catch(() => {
				/* ignore — user can retry */
			});
	}

	private openSelectedConversation(): void {
		const sel = this.convList?.getSelectedItem?.();
		if (!sel) return;
		this.onOpenConversation?.(String(sel.value));
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.onCancel?.();
			return;
		}
		if (matchesKey(data, 's')) {
			this.cycleStatus();
			return;
		}
		if (matchesKey(data, 'o')) {
			this.openSelectedConversation();
			return;
		}
		this.convList?.handleInput?.(data);
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate?.();
	}
}
