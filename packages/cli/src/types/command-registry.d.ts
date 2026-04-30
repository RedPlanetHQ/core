declare module 'virtual:command-registry' {
	import type {ReactElement} from 'react';

	export type CommandModule = {
		default?: (props: unknown) => ReactElement | null;
		description?: string;
		isDefault?: boolean;
		alias?: string;
		options?: unknown;
		args?: unknown;
	};

	/**
	 * Flat map of route-key → command module exports.
	 * Synthesized at bundle time by scripts/build-binary.ts.
	 *
	 *   'index'         → src/commands/index.tsx
	 *   'login'         → src/commands/login.tsx
	 *   'folder/index'  → src/commands/folder/index.tsx
	 *   'folder/add'    → src/commands/folder/add.tsx
	 */
	export const commandModules: Record<string, CommandModule>;
}
