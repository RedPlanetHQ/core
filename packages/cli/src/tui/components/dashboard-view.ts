import {Text, Spacer, Container, Loader, matchesKey, Key} from '@mariozechner/pi-tui';
import type {Component, TUI} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import {loadWidgetBundle} from '../utils/widget-loader.js';
import {getPreferences} from '../../config/preferences.js';
import type {WidgetConfig} from '../../types/config.js';

/** Wraps a pi-tui Component in a unicode border box */
class BoxedComponent implements Component {
	constructor(
		private inner: Component,
		private title: string,
	) {}

	render(width: number): string[] {
		const innerWidth = Math.max(0, width - 4);
		const innerLines = this.inner.render(innerWidth);

		const titleStr = ` ${this.title} `;
		const topFill = Math.max(0, width - 4 - titleStr.length);
		const top =
			'┌─' + titleStr + '─'.repeat(topFill) + '─┐';
		const bottom = '└' + '─'.repeat(width - 2) + '┘';

		const lines: string[] = [top];
		for (const line of innerLines) {
			// strip ANSI to measure visible length
			const visible = line.replace(/\x1b\[[0-9;]*m/g, '');
			const pad = Math.max(0, innerWidth - visible.length);
			lines.push('│  ' + line + ' '.repeat(pad) + '  │');
		}
		lines.push(bottom);
		return lines;
	}

	handleInput(data: string): void {
		(this.inner as {handleInput?: (d: string) => void}).handleInput?.(data);
	}

	invalidate(): void {
		(this.inner as {invalidate?: () => void}).invalidate?.();
	}
}

interface WidgetBundleSpec {
	slug: string;
	render: (ctx: unknown) => Promise<unknown>;
}

export class DashboardView implements Component {
	private container: Container;
	private headerText: Text;
	private bodyContainer: Container;
	private bodyChildren: Component[] = [];

	onCancel?: () => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private tui: TUI,
		private onRender: () => void,
	) {
		this.container = new Container();
		this.headerText = new Text(
			chalk.bold('Dashboard') + chalk.dim('  Esc close'),
			1,
			0,
		);
		this.bodyContainer = new Container();

		this.container.addChild(new Spacer(1));
		this.container.addChild(this.headerText);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.bodyContainer);

		this.load();
	}

	private addToBody(child: Component): void {
		this.bodyChildren.push(child);
		this.bodyContainer.addChild(child);
	}

	private async load(): Promise<void> {
		const prefs = getPreferences();
		const overviewWidgets = prefs.widgets?.overview ?? [];

		if (overviewWidgets.length === 0) {
			this.addToBody(
				new Text(
					chalk.dim(
						'No overview widgets configured. Use /widgets to select widgets.',
					),
					1,
					0,
				),
			);
			this.onRender();
			return;
		}

		for (const config of overviewWidgets) {
			await this.loadAndRenderWidget(config);
		}
	}

	private async loadAndRenderWidget(config: WidgetConfig): Promise<void> {
		const spinner = new Loader(
			this.tui,
			s => chalk.cyan(s),
			s => chalk.dim(s),
			`Loading ${config.widgetName}...`,
		);
		spinner.start();
		this.addToBody(spinner);
		this.onRender();

		try {
			const mod = await loadWidgetBundle(config.frontendUrl);
			const bundleWidgets = mod.widgets as WidgetBundleSpec[];
			const widget = bundleWidgets.find(w => w.slug === config.widgetSlug);

			spinner.stop();
			try {
				this.bodyContainer.removeChild(spinner);
			} catch {
				/* ignore */
			}
			this.bodyChildren = this.bodyChildren.filter(c => c !== spinner);

			if (!widget) {
				this.addToBody(
					new Text(
						chalk.dim(`Widget "${config.widgetSlug}" not found in bundle`),
						0,
						1,
					),
				);
				this.onRender();
				return;
			}

			const ctx = {
				placement: 'tui' as const,
				pat: this.apiKey,
				accounts: [
					{
						id: config.accountId,
						slug: config.accountSlug,
						name: config.accountName,
					},
				],
				baseUrl: this.baseUrl,
				requestRender: this.onRender,
			};

			const component = (await widget.render(ctx)) as Component;
			if (component && typeof component.render === 'function') {
				const boxed = new BoxedComponent(component, config.widgetName);
				this.addToBody(boxed);
				this.addToBody(new Spacer(1));
			}
		} catch (err: unknown) {
			spinner.stop();
			try {
				this.bodyContainer.removeChild(spinner);
			} catch {
				/* ignore */
			}
			this.bodyChildren = this.bodyChildren.filter(c => c !== spinner);
			const msg = err instanceof Error ? err.message : String(err);
			this.addToBody(
				new Text(
					chalk.dim(`─ ${config.widgetName} `) +
						chalk.red('Error: ') +
						chalk.dim(msg),
					0,
					1,
				),
			);
		}

		this.onRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.onCancel?.();
		}
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate?.();
	}
}
