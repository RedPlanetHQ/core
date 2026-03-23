import {Text, Spacer, Container, Loader, matchesKey, Key} from '@mariozechner/pi-tui';
import type {Component, TUI} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import {fetchIntegrationAccounts} from '../utils/stream.js';
import type {IntegrationAccount} from '../utils/stream.js';
import {getPreferences, updatePreferences} from '../../config/preferences.js';
import type {WidgetConfig} from '../../types/config.js';

interface WidgetMeta {
	name: string;
	slug: string;
	description: string;
	support: Array<'tui' | 'webapp'>;
	tuiPlacement?: 'overview' | 'below-input';
}

interface WidgetOption {
	meta: WidgetMeta;
	account: IntegrationAccount;
	widgetUrl: string;
}

type Tab = 'overview' | 'below-input';

export class WidgetsView implements Component {
	private container: Container;
	private headerText: Text;
	private bodyContainer: Container;
	private bodyChildren: Component[] = [];

	private tab: Tab = 'below-input';
	private overviewOptions: WidgetOption[] = [];
	private belowInputOptions: WidgetOption[] = [];
	private cursor = 0;
	private loading = false;

	// Keys are `${widgetSlug}:${accountId}`
	private selectedBelowInput: string | null = null;
	private selectedOverview: Set<string> = new Set();

	onCancel?: () => void;

	constructor(
		private baseUrl: string,
		private apiKey: string,
		private tui: TUI,
		private onRender: () => void,
	) {
		this.container = new Container();
		this.headerText = new Text('', 1, 0);
		this.bodyContainer = new Container();

		this.container.addChild(new Spacer(1));
		this.container.addChild(this.headerText);
		this.container.addChild(new Spacer(1));
		this.container.addChild(this.bodyContainer);

		// Load saved selections from config
		const prefs = getPreferences();
		const saved = prefs.widgets ?? {};
		if (saved.belowInput) {
			this.selectedBelowInput = `${saved.belowInput.widgetSlug}:${saved.belowInput.accountId}`;
		}
		for (const w of saved.overview ?? []) {
			this.selectedOverview.add(`${w.widgetSlug}:${w.accountId}`);
		}

		this.load();
	}

	private key(option: WidgetOption): string {
		return `${option.meta.slug}:${option.account.id}`;
	}

	private currentOptions(): WidgetOption[] {
		return this.tab === 'below-input'
			? this.belowInputOptions
			: this.overviewOptions;
	}

	private updateHeader(): void {
		const overview =
			this.tab === 'overview'
				? chalk.bgWhite.black(' Overview ')
				: chalk.dim(' Overview ');
		const belowInput =
			this.tab === 'below-input'
				? chalk.bgWhite.black(' Below Input ')
				: chalk.dim(' Below Input ');

		this.headerText.setText(
			overview +
				' ' +
				belowInput +
				chalk.dim('  Tab · ↑↓ · Space toggle · Esc save'),
		);
	}

	private clearBody(): void {
		for (const child of this.bodyChildren) {
			try {
				this.bodyContainer.removeChild(child);
			} catch {
				// ignore
			}
		}
		this.bodyChildren = [];
	}

	private addToBody(child: Component): void {
		this.bodyChildren.push(child);
		this.bodyContainer.addChild(child);
	}

	private rebuildList(): void {
		this.clearBody();
		const options = this.currentOptions();

		if (options.length === 0) {
			this.addToBody(
				new Text(chalk.dim('No TUI widgets available.'), 1, 0),
			);
			this.onRender();
			return;
		}

		// Clamp cursor
		this.cursor = Math.max(0, Math.min(this.cursor, options.length - 1));

		for (let i = 0; i < options.length; i++) {
			const opt = options[i];
			const k = this.key(opt);
			const isHighlighted = i === this.cursor;

			const isSelected =
				this.tab === 'below-input'
					? this.selectedBelowInput === k
					: this.selectedOverview.has(k);

			const checkbox = isSelected
				? chalk.green('[x]')
				: chalk.dim('[ ]');

			const label = isHighlighted
				? chalk.bold.white(opt.meta.name) +
					chalk.dim(' · ' + opt.account.integrationDefinition.name)
				: chalk.white(opt.meta.name) +
					chalk.dim(' · ' + opt.account.integrationDefinition.name);

			const prefix = isHighlighted ? chalk.cyan('▶ ') : '  ';

			this.addToBody(new Text(prefix + checkbox + ' ' + label, 0, 0));

			if (isHighlighted && opt.meta.description) {
				this.addToBody(
					new Text(
						chalk.dim('    ' + opt.meta.description),
						0,
						0,
					),
				);
			}
		}

		this.onRender();
	}

	private toggleCurrent(): void {
		const options = this.currentOptions();
		if (options.length === 0) return;
		const opt = options[this.cursor];
		const k = this.key(opt);

		if (this.tab === 'below-input') {
			this.selectedBelowInput = this.selectedBelowInput === k ? null : k;
		} else {
			if (this.selectedOverview.has(k)) {
				this.selectedOverview.delete(k);
			} else {
				this.selectedOverview.add(k);
			}
		}

		this.rebuildList();
	}

	private saveAndClose(): void {
		// Map options by key for fast lookup
		const allOptions = [
			...this.belowInputOptions,
			...this.overviewOptions,
		];
		const byKey = new Map<string, WidgetOption>(
			allOptions.map(o => [this.key(o), o]),
		);

		const toConfig = (opt: WidgetOption): WidgetConfig => ({
			widgetSlug: opt.meta.slug,
			widgetName: opt.meta.name,
			widgetUrl: opt.widgetUrl,
			accountId: opt.account.id,
			accountSlug: opt.account.integrationDefinition.slug,
			accountName: opt.account.integrationDefinition.name,
		});

		let belowInput: WidgetConfig | null = null;
		if (this.selectedBelowInput) {
			const opt = byKey.get(this.selectedBelowInput);
			if (opt) belowInput = toConfig(opt);
		}

		const overview: WidgetConfig[] = [];
		for (const k of this.selectedOverview) {
			const opt = byKey.get(k);
			if (opt) overview.push(toConfig(opt));
		}

		updatePreferences({widgets: {belowInput, overview}});
		this.onCancel?.();
	}

	private async load(): Promise<void> {
		if (this.loading) return;
		this.loading = true;

		this.updateHeader();

		const loaderComp = new Loader(
			this.tui,
			s => chalk.cyan(s),
			s => chalk.dim(s),
			'Loading widgets...',
		);
		loaderComp.start();
		this.addToBody(loaderComp);
		this.onRender();

		try {
			const accounts = await fetchIntegrationAccounts(
				this.baseUrl,
				this.apiKey,
			);

			loaderComp.stop();
			try {
				this.bodyContainer.removeChild(loaderComp);
			} catch {
				/* ignore */
			}
			this.bodyChildren = this.bodyChildren.filter(c => c !== loaderComp);

			for (const account of accounts) {
				const def = account.integrationDefinition;
				if (!def.widgetUrl) continue;

				const spec = def.spec as {widgets?: WidgetMeta[]} | null;
				const widgets = spec?.widgets ?? [];

				for (const w of widgets) {
					if (!w.support.includes('tui')) continue;
					const option: WidgetOption = {
						meta: w,
						account,
						widgetUrl: def.widgetUrl,
					};
					if (w.tuiPlacement === 'below-input') {
						this.belowInputOptions.push(option);
					} else {
						this.overviewOptions.push(option);
					}
				}
			}

			this.loading = false;
			this.rebuildList();
		} catch (err: unknown) {
			loaderComp.stop();
			try {
				this.bodyContainer.removeChild(loaderComp);
			} catch {
				/* ignore */
			}
			this.bodyChildren = this.bodyChildren.filter(c => c !== loaderComp);
			const msg = err instanceof Error ? err.message : String(err);
			this.addToBody(new Text(chalk.red('Error: ') + chalk.dim(msg), 1, 0));
			this.loading = false;
			this.onRender();
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.saveAndClose();
			return;
		}

		if (matchesKey(data, Key.tab)) {
			this.tab = this.tab === 'below-input' ? 'overview' : 'below-input';
			this.cursor = 0;
			this.updateHeader();
			this.rebuildList();
			return;
		}

		if (matchesKey(data, Key.up)) {
			const opts = this.currentOptions();
			if (this.cursor > 0) {
				this.cursor--;
				this.rebuildList();
			} else {
				this.cursor = Math.max(0, opts.length - 1);
				this.rebuildList();
			}
			return;
		}

		if (matchesKey(data, Key.down)) {
			const opts = this.currentOptions();
			if (this.cursor < opts.length - 1) {
				this.cursor++;
				this.rebuildList();
			} else {
				this.cursor = 0;
				this.rebuildList();
			}
			return;
		}

		if (data === ' ' || matchesKey(data, Key.enter)) {
			this.toggleCurrent();
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
