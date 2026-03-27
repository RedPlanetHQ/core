import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const _require = createRequire(import.meta.url);

function tryResolve(name: string): string | null {
	// Try CJS resolution first
	try {
		return pathToFileURL(_require.resolve(name)).href;
	} catch {
		// ignore
	}
	// Fall back to ESM resolution (handles ESM-only packages like @redplanethq/ui/tui).
	// import.meta.resolve is synchronous in Node 20.3+ but typed as Promise in older @types/node.
	try {
		const metaResolve = import.meta.resolve as ((id: string) => string) | undefined;
		if (typeof metaResolve === 'function') return metaResolve(name);
	} catch {
		// ignore
	}
	return null;
}

// Empty-module stub for deps the CLI doesn't have (e.g. web-only packages).
// The TUI render path never calls web components so undefined bindings are safe.
const STUB_URL = `data:text/javascript,export%20default%20{}`;

// Known deps — resolved to absolute file:// URLs if available, stub otherwise.
const KNOWN_DEPS: Array<[string, string]> = [
	['react', tryResolve('react') ?? STUB_URL],
	['react/jsx-runtime', tryResolve('react/jsx-runtime') ?? STUB_URL],
	['@mariozechner/pi-tui', tryResolve('@mariozechner/pi-tui') ?? STUB_URL],
	['@redplanethq/ui/tui', tryResolve('@redplanethq/ui/tui') ?? STUB_URL],
	['@redplanethq/ui/web', tryResolve('@redplanethq/ui/web') ?? STUB_URL],
];

export async function loadWidgetBundle(
	frontendUrl: string,
): Promise<{widgets: unknown[]}> {
	let src = await fetch(frontendUrl).then(r => {
		if (!r.ok) throw new Error(`Failed to fetch frontend bundle: ${r.status}`);
		return r.text();
	});

	// Strip source map comments — they won't resolve from a data URL.
	src = src.replace(/\/\/# sourceMappingURL=\S+/g, '');

	// Rewrite bare-specifier imports to absolute file:// or data: URLs.
	for (const [name, resolved] of KNOWN_DEPS) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// static:  from 'pkg'
		src = src.replace(
			new RegExp(`from ['"]${escaped}['"]`, 'g'),
			`from '${resolved}'`,
		);
		// dynamic: import('pkg')
		src = src.replace(
			new RegExp(`import\\(['"]${escaped}['"]\\)`, 'g'),
			`import('${resolved}')`,
		);
	}

	// Import via data URL — Node.js supports ESM data URLs natively.
	const dataUrl = `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`;
	return import(/* @vite-ignore */ dataUrl) as Promise<{widgets: unknown[]}>;
}
