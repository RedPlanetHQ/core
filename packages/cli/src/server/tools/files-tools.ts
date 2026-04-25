import zod from 'zod';
import {
	readFile,
	writeFile,
	mkdir,
	stat,
} from 'node:fs/promises';
import {dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {basename} from 'node:path';
import fastGlob from 'fast-glob';
import {createTwoFilesPatch} from 'diff';
import {listFolders, resolveFolderForPath} from '@/config/folders';
import {folderScopeError} from './scope-error';
import type {GatewayTool} from './browser-tools';

// ── Schemas ────────────────────────────────────────────────────────────────

const ReadSchema = zod.object({
	path: zod.string(),
	offset: zod.number().int().nonnegative().optional(),
	limit: zod.number().int().positive().optional(),
});

const WriteSchema = zod.object({
	path: zod.string(),
	content: zod.string(),
});

const EditSchema = zod.object({
	path: zod.string(),
	old_string: zod.string(),
	new_string: zod.string(),
	replace_all: zod.boolean().optional().default(false),
});

const GlobSchema = zod.object({
	pattern: zod.string(),
	path: zod.string().optional(),
});

const GrepSchema = zod.object({
	pattern: zod.string(),
	path: zod.string().optional(),
	glob: zod.string().optional(),
	type: zod.string().optional(),
	output_mode: zod
		.enum(['files_with_matches', 'content', 'count'])
		.optional()
		.default('files_with_matches'),
	context: zod.number().int().nonnegative().optional(),
	head_limit: zod.number().int().positive().optional(),
	case_insensitive: zod.boolean().optional().default(false),
});

// ── JSON Schemas (for manifest / agent tool descriptions) ──────────────────

const jsonSchemas: Record<string, Record<string, unknown>> = {
	files_read: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description:
					'Absolute path to the file. Must resolve to a folder registered with the `files` scope.',
			},
			offset: {
				type: 'number',
				description:
					'1-indexed line number to start reading from (useful for large files).',
			},
			limit: {
				type: 'number',
				description: 'Max number of lines to return (default: all).',
			},
		},
		required: ['path'],
	},
	files_write: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description:
					'Absolute path to write. Parent directories are created if missing.',
			},
			content: {
				type: 'string',
				description: 'File content (UTF-8). Overwrites any existing file.',
			},
		},
		required: ['path', 'content'],
	},
	files_edit: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Absolute path to the file to edit.',
			},
			old_string: {
				type: 'string',
				description:
					'Exact text to replace. Must be unique in the file unless replace_all is true. Preserve whitespace exactly.',
			},
			new_string: {
				type: 'string',
				description: 'Replacement text.',
			},
			replace_all: {
				type: 'boolean',
				description:
					'Replace every occurrence of old_string (default: false — error if ambiguous).',
			},
		},
		required: ['path', 'old_string', 'new_string'],
	},
	files_glob: {
		type: 'object',
		properties: {
			pattern: {
				type: 'string',
				description: 'Glob pattern (e.g. "src/**/*.tsx").',
			},
			path: {
				type: 'string',
				description:
					'Directory to search from (default: first registered folder with `files` scope).',
			},
		},
		required: ['pattern'],
	},
	files_grep: {
		type: 'object',
		properties: {
			pattern: {
				type: 'string',
				description: 'Regular expression to search for (ripgrep syntax).',
			},
			path: {
				type: 'string',
				description: 'File or directory to search in.',
			},
			glob: {
				type: 'string',
				description: 'Glob pattern to filter files (e.g. "*.ts").',
			},
			type: {
				type: 'string',
				description: 'Ripgrep file type (e.g. "js", "py", "rust").',
			},
			output_mode: {
				type: 'string',
				enum: ['files_with_matches', 'content', 'count'],
				description:
					'files_with_matches (default): paths only. content: matching lines. count: match counts per file.',
			},
			context: {
				type: 'number',
				description:
					'Lines of context around each match (only with output_mode=content).',
			},
			head_limit: {
				type: 'number',
				description: 'Limit the output to the first N lines.',
			},
			case_insensitive: {
				type: 'boolean',
				description: 'Case-insensitive match.',
			},
		},
		required: ['pattern'],
	},
};

// ── Tool Definitions ───────────────────────────────────────────────────────

export const filesTools: GatewayTool[] = [
	{
		name: 'files_read',
		description:
			'Read a file as UTF-8 text. Returns content with cat -n style line numbers so other tools (e.g. files_edit) can target specific regions precisely.',
		inputSchema: jsonSchemas.files_read!,
	},
	{
		name: 'files_write',
		description:
			'Create or overwrite a file. Creates parent directories as needed. Use files_edit for partial changes to avoid clobbering the file.',
		inputSchema: jsonSchemas.files_write!,
	},
	{
		name: 'files_edit',
		description:
			'Replace an exact text region in a file. Fails if old_string is not unique unless replace_all is true. Preserve whitespace exactly — the match is character-for-character.',
		inputSchema: jsonSchemas.files_edit!,
	},
	{
		name: 'files_glob',
		description:
			'Find files by glob pattern. Returns absolute paths sorted by modification time (newest first).',
		inputSchema: jsonSchemas.files_glob!,
	},
	{
		name: 'files_grep',
		description:
			'Search file contents with ripgrep. Supports path/glob/type filters, three output modes, and context lines. Requires `rg` on PATH.',
		inputSchema: jsonSchemas.files_grep!,
	},
];

// ── Scope enforcement ──────────────────────────────────────────────────────

function requireFilesScope(
	target: string,
): {absPath: string} | {error: string} {
	if (listFolders().length === 0) {
		// No folders registered → permissive (first-run / dev). Matches exec-tools.
		return {absPath: target};
	}
	const resolved = resolveFolderForPath(target, 'files');
	if (!resolved) {
		const e = folderScopeError(target, 'files');
		return {error: `${e.error.code}: ${e.error.message}`};
	}
	return {absPath: resolved.absPath};
}

function firstFilesFolder(): string | undefined {
	return listFolders().find(f => f.scopes.includes('files'))?.path;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatWithLineNumbers(
	text: string,
	startLineOneBased: number,
): string {
	const lines = text.split('\n');
	return lines
		.map((line, i) => {
			const n = startLineOneBased + i;
			const padded = String(n).padStart(6, ' ');
			return `${padded}\t${line}`;
		})
		.join('\n');
}

async function runRipgrep(
	args: string[],
	cwd: string,
): Promise<{stdout: string; stderr: string; code: number}> {
	return new Promise((resolve, reject) => {
		const child = spawn('rg', args, {cwd, stdio: ['ignore', 'pipe', 'pipe']});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on('data', c => stdoutChunks.push(c));
		child.stderr.on('data', c => stderrChunks.push(c));
		child.on('error', err => {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				reject(
					new Error(
						'`rg` (ripgrep) not found on PATH. Install it (brew install ripgrep / apt install ripgrep) to use files_grep.',
					),
				);
			} else {
				reject(err);
			}
		});
		child.on('close', code => {
			resolve({
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
				code: code ?? 1,
			});
		});
	});
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleRead(params: zod.infer<typeof ReadSchema>) {
	const scope = requireFilesScope(params.path);
	if ('error' in scope) return {success: false, error: scope.error};

	let raw: string;
	try {
		raw = await readFile(scope.absPath, 'utf8');
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {success: false, error: msg};
	}

	const allLines = raw.split('\n');
	const totalLines = allLines.length;
	const offset = params.offset ?? 1;
	const limit = params.limit ?? totalLines;
	const startIdx = Math.max(0, offset - 1);
	const endIdx = Math.min(totalLines, startIdx + limit);
	const slice = allLines.slice(startIdx, endIdx).join('\n');

	return {
		success: true,
		result: {
			path: scope.absPath,
			content: formatWithLineNumbers(slice, startIdx + 1),
			totalLines,
			returnedLines: endIdx - startIdx,
			startLine: startIdx + 1,
		},
	};
}

async function handleWrite(params: zod.infer<typeof WriteSchema>) {
	const scope = requireFilesScope(params.path);
	if ('error' in scope) return {success: false, error: scope.error};

	try {
		await mkdir(dirname(scope.absPath), {recursive: true});
		await writeFile(scope.absPath, params.content, 'utf8');
		const st = await stat(scope.absPath);
		return {
			success: true,
			result: {path: scope.absPath, bytesWritten: st.size},
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

async function handleEdit(params: zod.infer<typeof EditSchema>) {
	const scope = requireFilesScope(params.path);
	if ('error' in scope) return {success: false, error: scope.error};

	let raw: string;
	try {
		raw = await readFile(scope.absPath, 'utf8');
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}

	// Count occurrences (use split so we're not at the mercy of regex metachars)
	const occurrences = raw.split(params.old_string).length - 1;
	if (occurrences === 0) {
		return {
			success: false,
			error:
				'old_string not found in the file. Re-read the file (files_read) and match whitespace exactly.',
		};
	}
	if (occurrences > 1 && !params.replace_all) {
		return {
			success: false,
			error: `old_string appears ${occurrences} times. Pass a larger unique snippet or set replace_all=true.`,
		};
	}

	const next = params.replace_all
		? raw.split(params.old_string).join(params.new_string)
		: raw.replace(params.old_string, params.new_string);

	// Build a unified diff + structured hunks for the UI. Three lines of
	// context around each change — mirrors Claude Code's Edit approval view.
	const fileName = basename(scope.absPath);
	const unifiedDiff = createTwoFilesPatch(
		fileName,
		fileName,
		raw,
		next,
		undefined,
		undefined,
		{context: 3},
	);
	const hunks = parseUnifiedDiffHunks(unifiedDiff);

	try {
		await writeFile(scope.absPath, next, 'utf8');
		return {
			success: true,
			result: {
				path: scope.absPath,
				replacements: params.replace_all ? occurrences : 1,
				unifiedDiff,
				hunks,
			},
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

// ── Diff helpers ────────────────────────────────────────────────────────────

interface DiffLine {
	type: 'context' | 'add' | 'remove';
	oldLine: number | null;
	newLine: number | null;
	text: string;
}

interface DiffHunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
}

/**
 * Parse the unified diff text produced by `createTwoFilesPatch` into a list
 * of hunks with per-line type + line numbers. The structured form is what
 * the webapp UI renders (green/red bands, line gutters) without needing to
 * implement a unified-diff parser on the client.
 */
function parseUnifiedDiffHunks(unifiedDiff: string): DiffHunk[] {
	const lines = unifiedDiff.split('\n');
	const hunks: DiffHunk[] = [];
	let current: DiffHunk | null = null;
	let oldLine = 0;
	let newLine = 0;

	const header =
		/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

	for (const line of lines) {
		// Skip file headers (`--- a/x`, `+++ b/x`, `Index:` etc.)
		if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
		if (line.startsWith('Index:') || line.startsWith('===')) continue;

		const m = header.exec(line);
		if (m) {
			if (current) hunks.push(current);
			current = {
				oldStart: Number(m[1]),
				oldLines: m[2] ? Number(m[2]) : 1,
				newStart: Number(m[3]),
				newLines: m[4] ? Number(m[4]) : 1,
				lines: [],
			};
			oldLine = current.oldStart;
			newLine = current.newStart;
			continue;
		}

		if (!current) continue;

		if (line.startsWith('-')) {
			current.lines.push({
				type: 'remove',
				oldLine,
				newLine: null,
				text: line.slice(1),
			});
			oldLine += 1;
		} else if (line.startsWith('+')) {
			current.lines.push({
				type: 'add',
				oldLine: null,
				newLine,
				text: line.slice(1),
			});
			newLine += 1;
		} else if (line.startsWith(' ')) {
			current.lines.push({
				type: 'context',
				oldLine,
				newLine,
				text: line.slice(1),
			});
			oldLine += 1;
			newLine += 1;
		}
		// "\ No newline at end of file" markers and blank lines fall through.
	}
	if (current) hunks.push(current);
	return hunks;
}

async function handleGlob(params: zod.infer<typeof GlobSchema>) {
	const base = params.path ?? firstFilesFolder() ?? process.cwd();
	const scope = requireFilesScope(base);
	if ('error' in scope) return {success: false, error: scope.error};

	try {
		const matches = await fastGlob(params.pattern, {
			cwd: scope.absPath,
			absolute: true,
			onlyFiles: true,
			dot: false,
			suppressErrors: true,
			stats: true,
		});
		// Sort newest-first by mtime for Claude Code parity.
		const sorted = matches
			.map(m => ({
				path: m.path,
				mtimeMs: m.stats?.mtimeMs ?? 0,
			}))
			.sort((a, b) => b.mtimeMs - a.mtimeMs)
			.map(m => m.path);

		return {
			success: true,
			result: {pattern: params.pattern, path: scope.absPath, matches: sorted, count: sorted.length},
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

async function handleGrep(params: zod.infer<typeof GrepSchema>) {
	const base = params.path ?? firstFilesFolder() ?? process.cwd();
	const scope = requireFilesScope(base);
	if ('error' in scope) return {success: false, error: scope.error};

	const args: string[] = [];
	if (params.case_insensitive) args.push('-i');

	switch (params.output_mode) {
		case 'files_with_matches':
			args.push('--files-with-matches');
			break;
		case 'count':
			args.push('--count');
			break;
		case 'content':
			args.push('-n');
			if (params.context !== undefined) {
				args.push('-C', String(params.context));
			}
			break;
	}
	if (params.glob) args.push('--glob', params.glob);
	if (params.type) args.push('--type', params.type);
	args.push(params.pattern);
	args.push(scope.absPath);

	try {
		const {stdout, stderr, code} = await runRipgrep(args, scope.absPath);
		// rg exits 1 when there are no matches — that's not an error for us.
		if (code > 1) {
			return {
				success: false,
				error: stderr || `rg exited with code ${code}`,
			};
		}
		let out = stdout;
		if (params.head_limit !== undefined) {
			out = out.split('\n').slice(0, params.head_limit).join('\n');
		}
		return {
			success: true,
			result: {pattern: params.pattern, output_mode: params.output_mode, output: out},
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

// ── Dispatch ───────────────────────────────────────────────────────────────

export async function executeFilesTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	try {
		switch (toolName) {
			case 'files_read':
				return await handleRead(ReadSchema.parse(params));
			case 'files_write':
				return await handleWrite(WriteSchema.parse(params));
			case 'files_edit':
				return await handleEdit(EditSchema.parse(params));
			case 'files_glob':
				return await handleGlob(GlobSchema.parse(params));
			case 'files_grep':
				return await handleGrep(GrepSchema.parse(params));
			default:
				return {success: false, error: `Unknown tool: ${toolName}`};
		}
	} catch (err) {
		if (err instanceof zod.ZodError) {
			return {success: false, error: `Invalid parameters: ${err.message}`};
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Unknown error',
		};
	}
}
