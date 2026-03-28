import {loadBundle} from './bundle-loader.js';

export interface WidgetContext {
	placement: 'tui' | 'webapp';
	pat: string;
	accounts: Array<{id: string; slug: string; name: string}>;
	baseUrl: string;
	requestRender: () => void;
}

export interface WidgetDefinition {
	slug: string;
	render: (ctx: WidgetContext) => Promise<unknown>;
}

export interface WidgetBundle {
	widgets: WidgetDefinition[];
}

export async function loadWidgetBundle(frontendUrl: string): Promise<WidgetBundle> {
	const mod = await loadBundle(frontendUrl);
	return {widgets: (mod.widgets as WidgetDefinition[]) ?? []};
}
