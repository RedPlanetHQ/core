import React, {useState, useEffect, useMemo} from 'react';
import {Box, Text, useInput, useApp} from 'ink';
import TextInput from 'ink-text-input';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {CoreClient} from '@redplanethq/sdk';
import {getConfig} from '@/config/index';

const BASE_URL = 'https://app.getcore.me';
const FETCH_MORE = '__fetch_more__';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

	for (const block of text.split('\n\n').filter(Boolean)) {
		if (block.startsWith('Found ')) continue;
		if (block.startsWith('next_cursor: ')) {
			nextCursor = block.slice('next_cursor: '.length).trim();
			continue;
		}
		const lines = block.split('\n');
		const idLine = lines.find((l) => l.startsWith('ID: '));
		const titleLine = lines.find((l) => l.startsWith('Title: '));
		const urlLine = lines.find((l) => l.startsWith('URL: '));
		const createdLine = lines.find((l) => l.startsWith('Created: '));
		const lastEditedLine = lines.find((l) => l.startsWith('Last edited: '));
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
	query?: string,
): Promise<SearchResult> {
	const parameters: Record<string, any> = {
		filter: {value: 'page', property: 'object'},
		page_size: 10,
	};
	if (cursor) parameters.start_cursor = cursor;
	if (query) parameters.query = query;

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

// ---------------------------------------------------------------------------
// BrowseMode component — search box + page list rendered simultaneously
// ---------------------------------------------------------------------------

type BrowsePhase = 'browse' | 'ingesting' | 'post-ingest';

interface IngestStats {
	success: number;
	fail: number;
}

function BrowseMode({
	notionAccountId,
	client,
	onDone,
}: {
	notionAccountId: string;
	client: CoreClient;
	onDone: () => void;
}) {
	const [pages, setPages] = useState<NotionPage[]>([]);
	const [nextCursor, setNextCursor] = useState<string | undefined>();
	const [searchQuery, setSearchQuery] = useState('');
	const [submittedQuery, setSubmittedQuery] = useState('');
	const [loading, setLoading] = useState(false);
	const [loadingMsg, setLoadingMsg] = useState('Fetching pages...');
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [listCursor, setListCursor] = useState(0);
	const [focus, setFocus] = useState<'search' | 'list'>('search');
	const [phase, setPhase] = useState<BrowsePhase>('browse');
	const [menuCursor, setMenuCursor] = useState(0);
	const [stats, setStats] = useState<IngestStats>({success: 0, fail: 0});
	const [ingestingMsg, setIngestingMsg] = useState('');

	const listItems = useMemo(
		() => [
			...pages,
			...(nextCursor
				? [
						{
							id: FETCH_MORE,
							title: '↓ Fetch more pages',
							url: '',
							createdAt: '',
							lastEditedAt: '',
						},
					]
				: []),
		],
		[pages, nextCursor],
	);

	// Initial fetch
	useEffect(() => {
		void doLoad(undefined, '');
	}, []);

	async function doLoad(cursor?: string, query?: string) {
		setLoading(true);
		setLoadingMsg(cursor ? 'Fetching more...' : 'Fetching pages...');
		try {
			const res = await fetchPagesViaAction(
				client,
				notionAccountId,
				cursor,
				query,
			);
			if (cursor) {
				setPages((prev) => [...prev, ...res.pages]);
			} else {
				setPages(res.pages);
				setListCursor(0);
			}
			setNextCursor(res.nextCursor);
		} finally {
			setLoading(false);
			setLoadingMsg('');
		}
	}

	async function handleIngest() {
		const toIngest = pages.filter((p) => selected.has(p.id));
		if (toIngest.length === 0) return;

		setPhase('ingesting');
		let success = 0;
		let fail = 0;

		for (const page of toIngest) {
			setIngestingMsg(`Loading "${page.title}"...`);
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
					metadata: {url: page.url},
				});
				success++;
			} catch {
				fail++;
			}
		}

		setSelected(new Set());
		setStats({success, fail});
		setPhase('post-ingest');
		setMenuCursor(0);
	}

	const postIngestMenu = ['Continue loading', 'Remove all (reset)', 'Exit'];

	useInput((_input, key) => {
		if (phase === 'ingesting') return;

		if (phase === 'post-ingest') {
			if (key.upArrow) setMenuCursor((c) => Math.max(0, c - 1));
			else if (key.downArrow)
				setMenuCursor((c) => Math.min(postIngestMenu.length - 1, c + 1));
			else if (key.return) {
				if (menuCursor === 0) {
					setPhase('browse');
					setFocus('search');
				} else if (menuCursor === 1) {
					setPages([]);
					setNextCursor(undefined);
					setSelected(new Set());
					setPhase('browse');
					setFocus('search');
					void doLoad(undefined, '');
				} else {
					onDone();
				}
			}
			return;
		}

		// browse phase
		if (focus === 'search') {
			if (key.escape) {
				onDone();
				return;
			}
			if (key.tab || key.downArrow) {
				setFocus('list');
			}
			return;
		}

		// list focus
		if (key.upArrow) {
			if (listCursor === 0) setFocus('search');
			else setListCursor((c) => c - 1);
		} else if (key.downArrow) {
			setListCursor((c) => Math.min(listItems.length - 1, c + 1));
		} else if (_input === ' ') {
			const item = listItems[listCursor];
			if (!item || item.id === FETCH_MORE) return;
			setSelected((prev) => {
				const next = new Set(prev);
				if (next.has(item.id)) next.delete(item.id);
				else next.add(item.id);
				return next;
			});
		} else if (key.return) {
			const item = listItems[listCursor];
			if (!item) return;
			if (item.id === FETCH_MORE) {
				if (!loading) void doLoad(nextCursor, submittedQuery);
			} else if (selected.size > 0 && !loading) {
				void handleIngest();
			}
		} else if (key.escape) {
			onDone();
		}
	});

	// Post-ingest menu
	if (phase === 'post-ingest') {
		return (
			<Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
				<Text color={stats.fail === 0 ? 'green' : 'yellow'}>
					{`✓ Loaded ${stats.success} page(s)${stats.fail > 0 ? `, ${stats.fail} failed` : ''}`}
				</Text>
				<Box flexDirection="column">
					{postIngestMenu.map((item, i) => (
						<Text
							key={item}
							color={i === menuCursor ? 'cyan' : undefined}
							dimColor={i !== menuCursor}
						>
							{i === menuCursor ? '❯ ' : '  '}
							{item}
						</Text>
					))}
				</Box>
			</Box>
		);
	}

	// Ingesting
	if (phase === 'ingesting') {
		return (
			<Box paddingX={2}>
				<Text color="yellow">⠋ {ingestingMsg}</Text>
			</Box>
		);
	}

	// Browse
	return (
		<Box flexDirection="column" gap={1} paddingX={1}>
			{/* Search box */}
			<Box
				borderStyle="round"
				borderColor={focus === 'search' ? 'cyan' : 'gray'}
				paddingX={1}
			>
				<Text color="cyan">Search </Text>
				<TextInput
					value={searchQuery}
					onChange={setSearchQuery}
					onSubmit={(q) => {
						setSubmittedQuery(q);
						void doLoad(undefined, q);
						setFocus('list');
					}}
					focus={focus === 'search'}
					placeholder="Type to search, Enter to fetch..."
				/>
			</Box>

			{/* Page list */}
			<Box flexDirection="column">
				{loading ? (
					<Text color="yellow">{'  '}⠋ {loadingMsg}</Text>
				) : listItems.length === 0 ? (
					<Text dimColor>{'  '}No pages found</Text>
				) : (
					listItems.map((item, i) => {
						const isActive = focus === 'list' && i === listCursor;
						const isSelected = selected.has(item.id);
						const isFetchMore = item.id === FETCH_MORE;
						return (
							<Box key={item.id}>
								<Text
									color={
										isActive ? 'cyan' : isFetchMore ? 'yellow' : undefined
									}
									bold={isActive}
									dimColor={!isActive && !isFetchMore}
								>
									{`  ${isActive ? '❯' : ' '} ${isFetchMore ? '  ' : isSelected ? '◉ ' : '○ '}${item.title}`}
								</Text>
							</Box>
						);
					})
				)}
			</Box>

			{/* Status bar */}
			<Box>
				{selected.size > 0 ? (
					<Text color="green">{selected.size} selected — Enter to ingest</Text>
				) : (
					<Text dimColor>
						{focus === 'search'
							? 'Enter to search • Tab/↓ to list'
							: '↑↓ navigate • Space select • Enter ingest/fetch • Esc exit'}
					</Text>
				)}
			</Box>
		</Box>
	);
}

// ---------------------------------------------------------------------------
// Init flow (clack prompts) + entry component
// ---------------------------------------------------------------------------

type AppPhase =
	| {type: 'init'}
	| {type: 'browse'; notionAccountId: string; client: CoreClient}
	| {type: 'done'};

// Returns true when the process should exit (error / cancelled / all-mode done).
// Returns false when browse mode took over (Ink component handles the rest).
async function runInit(setPhase: (p: AppPhase) => void): Promise<boolean> {
	p.intro(chalk.bgCyan(chalk.black(' Load Notion ')));

	const config = getConfig();
	const apiKey = config.auth?.apiKey;
	const baseUrl = config.auth?.url || BASE_URL;

	if (!apiKey) {
		p.log.error('Not authenticated. Run `corebrain login` first.');
		return true;
	}

	const client = new CoreClient({baseUrl, token: apiKey});
	const spinner = p.spinner();

	// Check connection
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
			return true;
		}
		notionAccountId = notionAccount.id;
		spinner.stop(chalk.green('Notion connected'));
	} catch (err) {
		spinner.stop(chalk.red('Failed to fetch integrations'));
		p.log.error(err instanceof Error ? err.message : 'Unknown error');
		return true;
	}

	// Mode selection
	const loadMode = await p.select({
		message: 'How would you like to load Notion pages?',
		options: [
			{
				value: 'select',
				label: 'Browse & select',
				hint: 'Search and select pages interactively',
			},
			{
				value: 'exit',
				label: 'Exit',
			},
		],
	});

	if (p.isCancel(loadMode) || loadMode === 'exit') {
		p.cancel('Cancelled');
		return true;
	}

	// Browse mode — hand off to Ink component
	setPhase({type: 'browse', notionAccountId, client});
	return false;
}

export default function LoadNotion(_props: Props) {
	const {exit} = useApp();
	const [phase, setPhase] = useState<AppPhase>({type: 'init'});

	useEffect(() => {
		if (phase.type !== 'init') return;
		runInit(setPhase)
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
				return true;
			})
			.then((shouldExit) => {
				if (shouldExit) {
					// All-pages mode or error — exit after clack is done
					setTimeout(() => exit(), 100);
				}
			});
	}, []);

	useEffect(() => {
		if (phase.type === 'done') {
			p.outro(chalk.green('Done.'));
			setTimeout(() => exit(), 100);
		}
	}, [phase]);

	if (phase.type !== 'browse') return null;

	return (
		<BrowseMode
			notionAccountId={phase.notionAccountId}
			client={phase.client}
			onDone={() => setPhase({type: 'done'})}
		/>
	);
}
