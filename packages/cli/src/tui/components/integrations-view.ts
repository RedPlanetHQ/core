import {SelectList, Text, Spacer, Container, Loader, matchesKey, Key} from '@mariozechner/pi-tui';
import type {Component, TUI} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import {
	fetchIntegrationDefinitions,
	fetchIntegrationAccounts,
	openBrowser,
} from '../utils/stream.js';
import type {IntegrationDefinition, IntegrationAccount} from '../utils/stream.js';

const DASHBOARD_URL = 'https://app.getcore.me';

const selectListTheme = {
	selectedPrefix: (s: string) => chalk.cyan(s),
	selectedText: (s: string) => chalk.white(s),
	description: (s: string) => chalk.dim(s),
	scrollInfo: (s: string) => chalk.dim(s),
	noMatch: (s: string) => chalk.dim(s),
};

type TabMode = 'installed' | 'all';

export class IntegrationsView implements Component {
	private container: Container;
	private headerText: Text;
	private bodyContainer: Container;
	private list: SelectList | null = null;
	private emptyText: Text | null = null;

	private definitions: IntegrationDefinition[] = [];
	private accounts: IntegrationAccount[] = [];
	private tab: TabMode = 'installed';
	private loading = false;

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

		this.load();
	}

	private updateHeader(): void {
		const installed =
			this.tab === 'installed'
				? chalk.bgWhite.black(' Installed ')
				: chalk.dim(' Installed ');
		const all =
			this.tab === 'all'
				? chalk.bgWhite.black(' All ')
				: chalk.dim(' All ');

		this.headerText.setText(
			installed +
				' ' +
				all +
				chalk.dim('  Tab to cycle · Enter open · Esc close'),
		);
	}

	private buildInstalledItems() {
		if (this.accounts.length === 0) return [];
		return this.accounts.map(a => ({
			value: a.integrationDefinition.slug,
			label:
				(a.isActive ? chalk.green('● ') : chalk.dim('○ ')) +
				a.integrationDefinition.name,
			description: a.isActive ? 'connected' : 'inactive',
		}));
	}

	private buildAllItems() {
		return this.definitions.map(d => {
			const connected = this.accounts.some(
				a => a.integrationDefinitionId === d.id,
			);
			return {
				value: d.slug,
				label:
					(connected ? chalk.green('● ') : chalk.dim('○ ')) + d.name,
				description: d.description ?? '',
			};
		});
	}

	private rebuildList(): void {
		if (this.list) {
			try { this.bodyContainer.removeChild(this.list); } catch { /* ignore */ }
			this.list = null;
		}

		if (this.emptyText) {
			try { this.bodyContainer.removeChild(this.emptyText); } catch { /* ignore */ }
			this.emptyText = null;
		}

		const items =
			this.tab === 'installed'
				? this.buildInstalledItems()
				: this.buildAllItems();

		if (items.length === 0) {
			this.emptyText = new Text(
				chalk.dim(
					this.tab === 'installed'
						? 'No connected integrations. Tab to switch to All.'
						: 'No integrations found.',
				),
				1,
				0,
			);
			this.bodyContainer.addChild(this.emptyText);
			return;
		}

		this.list = new SelectList(items, 15, selectListTheme);
		this.list.onCancel = () => this.onCancel?.();
		this.list.onSelect = item => {
			openBrowser(`${DASHBOARD_URL}/home/integration/${item.value}`);
		};
		this.bodyContainer.addChild(this.list);
	}

	private load(): void {
		if (this.loading) return;
		this.loading = true;

		const loaderComp = new Loader(
			this.tui,
			s => chalk.cyan(s),
			s => chalk.dim(s),
			'Loading integrations...',
		);
		loaderComp.start();
		this.bodyContainer.addChild(loaderComp);
		this.updateHeader();
		this.onRender();

		Promise.all([
			fetchIntegrationDefinitions(this.baseUrl, this.apiKey),
			fetchIntegrationAccounts(this.baseUrl, this.apiKey),
		])
			.then(([defs, accs]) => {
				loaderComp.stop();
				try {
					this.bodyContainer.removeChild(loaderComp);
				} catch {
					/* ignore */
				}
				this.definitions = defs;
				this.accounts = accs;
				this.loading = false;
				// Default to All if nothing installed
				if (accs.length === 0) this.tab = 'all';
				this.rebuildList();
				this.onRender();
			})
			.catch((err: Error) => {
				loaderComp.stop();
				try {
					this.bodyContainer.removeChild(loaderComp);
				} catch {
					/* ignore */
				}
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

		if (matchesKey(data, Key.tab)) {
			this.tab = this.tab === 'installed' ? 'all' : 'installed';
			this.updateHeader();
			this.rebuildList();
			this.onRender();
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
