import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import { getConfig } from '@/config/index';

export const description = 'Search documents in your workspace';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

interface SearchDocument {
	id: string;
	title: string | null;
	createdAt: string;
	sessionId: string | null;
	source: string | null;
	labels?: Array<{ id: string; name: string }>;
}

interface FullDocument extends SearchDocument {
	content?: string;
	episodeBody?: string;
	labelIds?: string[];
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

function truncate(str: string, maxLength: number): string {
	if (str.length <= maxLength) return str;
	return str.slice(0, maxLength - 3) + '...';
}

async function searchDocuments(
	baseUrl: string,
	apiKey: string,
	query: string,
): Promise<SearchDocument[]> {
	const searchUrl = new URL(`${baseUrl}/api/v1/documents/search`);
	searchUrl.searchParams.set('q', query);
	searchUrl.searchParams.set('limit', '20');

	const response = await fetch(searchUrl.toString(), {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
	});

	if (!response.ok) {
		throw new Error('Search failed');
	}

	const result = (await response.json()) as { documents: SearchDocument[] };
	return result.documents || [];
}

async function fetchDocument(
	baseUrl: string,
	apiKey: string,
	documentId: string,
): Promise<FullDocument | null> {
	const response = await fetch(`${baseUrl}/api/v1/documents/${documentId}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
	});

	if (!response.ok) {
		throw new Error('Failed to fetch document');
	}

	const result = (await response.json()) as { document: FullDocument | null };
	return result.document;
}

// ---------------------------------------------------------------------------
// DocumentView component — shows full document content
// ---------------------------------------------------------------------------

function DocumentView({
	document,
	onBack,
}: {
	document: FullDocument;
	onBack: () => void;
}) {
	const [scrollOffset, setScrollOffset] = useState(0);
	const content = document.episodeBody || document.content || 'No content';
	const lines = content.split('\n');
	const visibleLines = 15;

	useInput((_input, key) => {
		if (key.escape || _input === 'q') {
			onBack();
		} else if (key.upArrow || _input === 'k') {
			setScrollOffset((prev) => Math.max(0, prev - 1));
		} else if (key.downArrow || _input === 'j') {
			setScrollOffset((prev) => Math.min(lines.length - visibleLines, prev + 1));
		} else if (key.pageUp) {
			setScrollOffset((prev) => Math.max(0, prev - visibleLines));
		} else if (key.pageDown) {
			setScrollOffset((prev) =>
				Math.min(lines.length - visibleLines, prev + visibleLines),
			);
		}
	});

	const displayLines = lines.slice(scrollOffset, scrollOffset + visibleLines);

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Header */}
			<Box
				borderStyle="single"
				borderColor="cyan"
				paddingX={1}
				flexDirection="column"
			>
				<Text bold color="cyan">
					{document.title || 'Untitled'}
				</Text>
				<Text dimColor>
					{document.source || 'unknown'} • {formatDate(document.createdAt)}
				</Text>
			</Box>

			{/* Content */}
			<Box
				flexDirection="column"
				borderStyle="single"
				borderColor="gray"
				paddingX={1}
				marginTop={1}
			>
				{displayLines.map((line, i) => (
					<Text key={scrollOffset + i}>{line || ' '}</Text>
				))}
			</Box>

			{/* Scroll indicator */}
			{lines.length > visibleLines && (
				<Box marginTop={1}>
					<Text dimColor>
						Lines {scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, lines.length)} of{' '}
						{lines.length}
					</Text>
				</Box>
			)}

			{/* Controls */}
			<Box marginTop={1}>
				<Text dimColor>↑↓/jk scroll • PgUp/PgDn page • q/Esc back</Text>
			</Box>
		</Box>
	);
}

// ---------------------------------------------------------------------------
// SearchMode component — search box + document list
// ---------------------------------------------------------------------------

type SearchPhase = 'search' | 'viewing';

function SearchMode({
	baseUrl,
	apiKey,
	onDone,
}: {
	baseUrl: string;
	apiKey: string;
	onDone: () => void;
}) {
	const [documents, setDocuments] = useState<SearchDocument[]>([]);
	const [searchQuery, setSearchQuery] = useState('');
	const [loading, setLoading] = useState(false);
	const [loadingMsg, setLoadingMsg] = useState('');
	const [listCursor, setListCursor] = useState(0);
	const [focus, setFocus] = useState<'search' | 'list'>('search');
	const [phase, setPhase] = useState<SearchPhase>('search');
	const [viewingDocument, setViewingDocument] = useState<FullDocument | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function doSearch(query: string) {
		if (!query.trim()) return;

		setLoading(true);
		setLoadingMsg('Searching...');
		setError(null);

		try {
			const results = await searchDocuments(baseUrl, apiKey, query);
			setDocuments(results);
			setListCursor(0);
			if (results.length > 0) {
				setFocus('list');
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Search failed');
		} finally {
			setLoading(false);
			setLoadingMsg('');
		}
	}

	async function viewDocument(documentId: string) {
		setLoading(true);
		setLoadingMsg('Loading document...');

		try {
			const doc = await fetchDocument(baseUrl, apiKey, documentId);
			if (doc) {
				setViewingDocument(doc);
				setPhase('viewing');
			} else {
				setError('Document not found');
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load document');
		} finally {
			setLoading(false);
			setLoadingMsg('');
		}
	}

	useInput((_input, key) => {
		if (phase === 'viewing') return;

		if (focus === 'search') {
			if (key.escape) {
				onDone();
				return;
			}
			if (key.tab || key.downArrow) {
				if (documents.length > 0) {
					setFocus('list');
				}
			}
			return;
		}

		// list focus
		if (key.upArrow) {
			if (listCursor === 0) {
				setFocus('search');
			} else {
				setListCursor((c) => c - 1);
			}
		} else if (key.downArrow) {
			setListCursor((c) => Math.min(documents.length - 1, c + 1));
		} else if (key.return) {
			const doc = documents[listCursor];
			if (doc && !loading) {
				void viewDocument(doc.id);
			}
		} else if (key.escape) {
			onDone();
		} else if (key.tab) {
			setFocus('search');
		}
	});

	// Viewing document
	if (phase === 'viewing' && viewingDocument) {
		return (
			<DocumentView
				document={viewingDocument}
				onBack={() => {
					setPhase('search');
					setViewingDocument(null);
					setFocus('list');
				}}
			/>
		);
	}

	// Search mode
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
						void doSearch(q);
					}}
					focus={focus === 'search'}
					placeholder="Type and press Enter to search..."
				/>
			</Box>

			{/* Error message */}
			{error && (
				<Box>
					<Text color="red">✗ {error}</Text>
				</Box>
			)}

			{/* Document count */}
			{!loading && documents.length > 0 && (
				<Box>
					<Text dimColor>{documents.length} document(s) found</Text>
				</Box>
			)}

			{/* Document list */}
			<Box flexDirection="column">
				{loading ? (
					<Text color="yellow">{'  '}⠋ {loadingMsg}</Text>
				) : documents.length === 0 ? (
					<Text dimColor>{'  '}No documents found. Try searching.</Text>
				) : (
					documents.map((doc, i) => {
						const isActive = focus === 'list' && i === listCursor;
						const labels = doc.labels?.map((l) => `#${l.name}`).join(' ') || '';
						const meta = [doc.source, labels].filter(Boolean).join(' ');
						return (
							<Box key={doc.id}>
								<Text
									color={isActive ? 'cyan' : undefined}
									bold={isActive}
									dimColor={!isActive}
								>
									{`  ${isActive ? '❯' : ' '} ${truncate(doc.title || 'Untitled', 40)}`}
								</Text>
								{meta && (
									<Text dimColor={!isActive} color={isActive ? 'gray' : undefined}>
										{' '}{meta}
									</Text>
								)}
							</Box>
						);
					})
				)}
			</Box>

			{/* Status bar */}
			<Box marginTop={1}>
				<Text dimColor>
					{focus === 'search'
						? 'Enter to search • Tab/↓ to results • Esc exit'
						: '↑↓ navigate • Enter to view • Tab to search • Esc exit'}
				</Text>
			</Box>
		</Box>
	);
}

// ---------------------------------------------------------------------------
// Init flow + entry component
// ---------------------------------------------------------------------------

type AppPhase = { type: 'init' } | { type: 'search'; baseUrl: string; apiKey: string } | { type: 'done' };

async function runInit(setPhase: (p: AppPhase) => void): Promise<boolean> {
	p.intro(chalk.bgCyan(chalk.black(' Search Documents ')));

	const config = getConfig();
	const apiKey = config.auth?.apiKey;
	const baseUrl = config.auth?.url;

	if (!apiKey || !baseUrl) {
		p.log.error('Not authenticated. Run `corebrain login` first.');
		return true;
	}

	// Hand off to Ink component
	setPhase({ type: 'search', baseUrl, apiKey });
	return false;
}

export default function Search(_props: Props) {
	const { exit } = useApp();
	const [phase, setPhase] = useState<AppPhase>({ type: 'init' });

	useEffect(() => {
		if (phase.type !== 'init') return;
		runInit(setPhase)
			.catch((err) => {
				p.log.error(err instanceof Error ? err.message : 'Unknown error');
				return true;
			})
			.then((shouldExit) => {
				if (shouldExit) {
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

	if (phase.type !== 'search') return null;

	return (
		<SearchMode
			baseUrl={phase.baseUrl}
			apiKey={phase.apiKey}
			onDone={() => setPhase({ type: 'done' })}
		/>
	);
}
