import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {CoreClient} from '@redplanethq/sdk';
import {getConfig} from '@/config/index';

const BASE_URL = 'https://app.getcore.me';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

interface NotionPage {
	id: string;
	title: string;
	url: string;
	createdAt: string;
	lastEditedAt: string;
}

interface SearchResult {
	pages: NotionPage[];
	nextCursor?: string;
}

function extractActionText(result: unknown): string {
	const r = result as any;
	if (r?.content?.[0]?.text) return r.content[0].text as string;
	if (typeof r === 'string') return r;
	return '';
}

function parseSearchResult(text: string): SearchResult {
	if (!text || text === 'No results found') return {pages: []};

	const pages: NotionPage[] = [];
	let nextCursor: string | undefined;
	const blocks = text.split('\n\n').filter(Boolean);

	for (const block of blocks) {
		if (block.startsWith('Found ')) continue;
		if (block.startsWith('next_cursor: ')) {
			nextCursor = block.slice('next_cursor: '.length).trim();
			continue;
		}
		const lines = block.split('\n');
		const idLine = lines.find(l => l.startsWith('ID: '));
		const titleLine = lines.find(l => l.startsWith('Title: '));
		const urlLine = lines.find(l => l.startsWith('URL: '));
		const createdLine = lines.find(l => l.startsWith('Created: '));
		const lastEditedLine = lines.find(l => l.startsWith('Last edited: '));
		if (!idLine) continue;
		pages.push({
			id: idLine.slice(4).trim(),
			title: titleLine?.slice(7).trim() || 'Untitled',
			url: urlLine?.slice(5).trim() || '',
			createdAt: createdLine?.slice(9).trim() || new Date().toISOString(),
			lastEditedAt:
				lastEditedLine?.slice(13).trim() || new Date().toISOString(),
		});
	}

	return {pages, nextCursor};
}

async function fetchPagesViaAction(
	client: CoreClient,
	accountId: string,
	cursor?: string,
): Promise<SearchResult> {
	const parameters: Record<string, any> = {
		filter: {value: 'page', property: 'object'},
		page_size: 10,
	};
	if (cursor) parameters.start_cursor = cursor;

	const {result} = await client.executeIntegrationAction({
		accountId,
		action: 'notion_search',
		parameters,
	});

	return parseSearchResult(extractActionText(result));
}

async function fetchPageContentViaAction(
	client: CoreClient,
	accountId: string,
	pageId: string,
): Promise<string> {
	const {result} = await client.executeIntegrationAction({
		accountId,
		action: 'notion_get_page',
		parameters: {page_id: pageId},
	});

	const text = extractActionText(result);
	try {
		const data = JSON.parse(text) as any;
		return data.text || data.title || '';
	} catch {
		return text;
	}
}

async function runNotionLoad(): Promise<void> {
	p.intro(chalk.bgCyan(chalk.black(' Load Notion ')));

	const config = getConfig();
	const apiKey = config.auth?.apiKey;
	const baseUrl = config.auth?.url || BASE_URL;

	if (!apiKey) {
		p.log.error('Not authenticated. Run `corebrain login` first.');
		return;
	}

	const client = new CoreClient({baseUrl, token: apiKey});
	const spinner = p.spinner();

	// 1. Check Notion connection
	spinner.start('Checking Notion connection...');
	let notionAccountId: string;
	try {
		const res = (await client.getIntegrationsConnected()) as any;
		const notionAccount = (res.accounts ?? []).find(
			(a: any) => a.integrationDefinition?.slug === 'notion',
		);

		if (!notionAccount) {
			spinner.stop(chalk.red('Notion not connected'));
			p.log.error(
				'Notion is not connected. Please connect it at ' +
					chalk.cyan(`${baseUrl}/home/integrations`),
			);
			return;
		}

		notionAccountId = notionAccount.id;
		spinner.stop(chalk.green('Notion connected'));
	} catch (err) {
		spinner.stop(chalk.red('Failed to fetch integrations'));
		p.log.error(err instanceof Error ? err.message : 'Unknown error');
		return;
	}

	// 2. Choose load mode
	const loadMode = await p.select({
		message: 'How would you like to load Notion pages?',
		options: [
			{
				value: 'select',
				label: 'Select pages',
				hint: 'Fetch pages first, then choose which to load',
			},
			{
				value: 'all',
				label: 'Load all pages',
				hint: 'Load every page in your workspace',
			},
		],
	});

	if (p.isCancel(loadMode)) {
		p.cancel('Cancelled');
		return;
	}

	let pagesToLoad: NotionPage[] = [];

	const FETCH_MORE = '__fetch_more__';

	if (loadMode === 'all') {
		const confirmed = await p.confirm({
			message: chalk.yellow(
				'Loading all pages will consume a significant amount of credits. Continue?',
			),
			initialValue: false,
		});

		if (p.isCancel(confirmed) || !confirmed) {
			p.cancel('Cancelled');
			return;
		}

		spinner.start('Fetching Notion pages...');
		let cursor: string | undefined;
		try {
			do {
				const batch = await fetchPagesViaAction(
					client,
					notionAccountId,
					cursor,
				);
				pagesToLoad.push(...batch.pages);
				cursor = batch.nextCursor;
				if (cursor) {
					spinner.message(
						`Fetching more pages (${pagesToLoad.length} so far)...`,
					);
				}
			} while (cursor);

			spinner.stop(chalk.green(`Found ${pagesToLoad.length} pages`));
		} catch (err) {
			spinner.stop(chalk.red('Failed to fetch pages'));
			p.log.error(err instanceof Error ? err.message : 'Unknown error');
			return;
		}
	} else {
		// Fetch first batch
		spinner.start('Fetching Notion pages...');
		let allFetched: NotionPage[] = [];
		let nextCursor: string | undefined;
		try {
			const first = await fetchPagesViaAction(client, notionAccountId);
			allFetched = first.pages;
			nextCursor = first.nextCursor;
			spinner.stop(chalk.green(`Fetched ${allFetched.length} pages`));
		} catch (err) {
			spinner.stop(chalk.red('Failed to fetch pages'));
			p.log.error(err instanceof Error ? err.message : 'Unknown error');
			return;
		}

		if (allFetched.length === 0) {
			p.log.warn('No pages found in your Notion workspace.');
			return;
		}

		let currentSelections: string[] = [];

		while (true) {
			const selectOptions = allFetched.map(page => ({
				value: page.id,
				label: page.title,
				hint: page.url,
			}));

			if (nextCursor) {
				selectOptions.push({
					value: FETCH_MORE,
					label: '↓ Fetch more pages',
					hint: 'Load the next 10 pages',
				});
			}

			const selected = await p.multiselect({
				message: `Select pages to load (${allFetched.length} fetched)`,
				options: selectOptions,
				initialValues: currentSelections,
				required: false,
			});

			if (p.isCancel(selected)) {
				p.cancel('Cancelled');
				return;
			}

			const selectedArr = selected as string[];

			if (selectedArr.includes(FETCH_MORE)) {
				currentSelections = selectedArr.filter(id => id !== FETCH_MORE);
				spinner.start('Fetching more pages...');
				try {
					const more = await fetchPagesViaAction(
						client,
						notionAccountId,
						nextCursor,
					);
					allFetched = [...allFetched, ...more.pages];
					nextCursor = more.nextCursor;
					spinner.stop(chalk.green(`Fetched ${allFetched.length} pages total`));
				} catch (err) {
					spinner.stop(chalk.red('Failed to fetch more pages'));
					p.log.error(err instanceof Error ? err.message : 'Unknown error');
					return;
				}
			} else {
				pagesToLoad = allFetched.filter(page => selectedArr.includes(page.id));
				break;
			}
		}
	}

	if (pagesToLoad.length === 0) {
		p.log.warn('No pages selected.');
		return;
	}

	// 3. Ingest pages
	p.log.info(`Ingesting ${pagesToLoad.length} page(s) into Core...`);

	let successCount = 0;
	let failCount = 0;

	for (const page of pagesToLoad) {
		spinner.start(`Loading "${page.title}"...`);
		try {
			const content = await fetchPageContentViaAction(
				client,
				notionAccountId,
				page.id,
			);

			await client.ingest({
				episodeBody: content || `Notion page: ${page.title}`,
				source: 'notion',
				referenceTime: page.lastEditedAt,
				sessionId: page.id,
				title: page.title,
				type: 'DOCUMENT',
				metadata: {
					url: page.url,
				},
			});

			spinner.stop(chalk.green(`✓ ${page.title}`));
			successCount++;
		} catch (err) {
			spinner.stop(
				chalk.red(
					`✗ ${page.title}: ${
						err instanceof Error ? err.message : 'Unknown error'
					}`,
				),
			);
			failCount++;
		}
	}

	p.outro(
		failCount === 0
			? chalk.green(`Successfully loaded ${successCount} page(s) into Core.`)
			: chalk.yellow(`Loaded ${successCount} page(s), ${failCount} failed.`),
	);
}

export default function LoadNotion(_props: Props) {
	const {exit} = useApp();

	useEffect(() => {
		runNotionLoad()
			.catch(err => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [exit]);

	return null;
}
