import {
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
	type TaskDetail as TaskDetailData,
} from '../utils/stream.js';
import {htmlToMarkdown} from '../utils/html-to-md.js';
import {markdownTheme} from '../themes.js';

class Divider implements Component {
	render(width: number): string[] {
		return [chalk.dim('─'.repeat(Math.max(1, width)))];
	}
	invalidate(): void {
		/* stateless */
	}
}

export class TaskDetail implements Component {
	private container: Container;
	private headerText: Text;
	private bodyContainer: Container;
	private detail: TaskDetailData | null = null;

	onCancel?: () => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private taskId: string,
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
		const t = this.detail;
		const title = t?.title ?? 'Loading…';
		this.headerText.setText(chalk.bold.white(title));
	}

	private renderBody(): void {
		this.bodyContainer.clear();

		const t = this.detail;
		if (!t) return;

		const id = t.displayId ? chalk.dim(`[${t.displayId}]`) : '';
		const status = chalk.cyan(t.status);
		const subtaskCount = t.subtaskCount ?? 0;
		const subtasks =
			subtaskCount > 0
				? chalk.dim(
						`${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'}`,
					)
				: '';
		const sep = chalk.dim(' · ');
		const meta = [id, status, subtasks].filter(Boolean).join(sep);
		const hint = chalk.dim('Esc back');

		this.bodyContainer.addChild(new Text(`${meta}    ${hint}`, 1, 0));
		this.bodyContainer.addChild(new Divider());
		this.bodyContainer.addChild(new Spacer(1));

		const descMd = htmlToMarkdown(t.description);
		if (descMd) {
			this.bodyContainer.addChild(new Markdown(descMd, 1, 0, markdownTheme));
		} else {
			this.bodyContainer.addChild(
				new Text(chalk.dim('(no description)'), 1, 0),
			);
		}
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

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.onCancel?.();
			return;
		}
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate?.();
	}
}
