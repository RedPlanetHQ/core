import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const _require = createRequire(import.meta.url);

function tryResolve(name: string): string | null {
	try {
		return pathToFileURL(_require.resolve(name)).href;
	} catch {
		// ignore
	}
	try {
		const metaResolve = import.meta.resolve as ((id: string) => string) | undefined;
		if (typeof metaResolve === 'function') return metaResolve(name);
	} catch {
		// ignore
	}
	return null;
}

// Empty-module stub for deps the CLI doesn't have (e.g. web-only packages).
const STUB_URL = `data:text/javascript,export%20default%20{}`;

// Known deps — resolved to absolute file:// URLs if available, stub otherwise.
const KNOWN_DEPS: Array<[string, string]> = [
	['react', tryResolve('react') ?? STUB_URL],
	['react/jsx-runtime', tryResolve('react/jsx-runtime') ?? STUB_URL],
	['@mariozechner/pi-tui', tryResolve('@mariozechner/pi-tui') ?? STUB_URL],
	['@redplanethq/ui/tui', tryResolve('@redplanethq/ui/tui') ?? STUB_URL],
	['@redplanethq/ui/web', tryResolve('@redplanethq/ui/web') ?? STUB_URL],
];

/** Fetch a remote JS bundle, rewrite bare-specifier imports, and dynamically import it. */
export async function loadBundle(frontendUrl: string): Promise<Record<string, unknown>> {
	let src = await fetch(frontendUrl).then(r => {
		if (!r.ok) throw new Error(`Failed to fetch bundle: ${r.status}`);
		return r.text();
	});

	// Strip source map comments — they won't resolve from a data URL.
	src = src.replace(/\/\/# sourceMappingURL=\S+/g, '');

	// Rewrite bare-specifier imports to absolute file:// or data: URLs.
	for (const [name, resolved] of KNOWN_DEPS) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		src = src.replace(
			new RegExp(`from ['"]${escaped}['"]`, 'g'),
			`from '${resolved}'`,
		);
		src = src.replace(
			new RegExp(`import\\(['"]${escaped}['"]\\)`, 'g'),
			`import('${resolved}')`,
		);
	}

	const dataUrl = `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`;
	return import(/* @vite-ignore */ dataUrl) as Promise<Record<string, unknown>>;
}
