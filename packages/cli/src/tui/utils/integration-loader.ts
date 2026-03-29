import type {Component} from '@mariozechner/pi-tui';
import {loadBundle} from './bundle-loader.js';

export interface ToolUIContext {
	placement: 'tui' | 'webapp';
	[key: string]: unknown;
}

export interface IntegrationToolUI {
	supported_tools: string[];
	render: (
		toolName: string,
		input: Record<string, unknown>,
		result: unknown,
		context: ToolUIContext,
		submitInput: (newInput: Record<string, unknown>) => void,
		onDecline: () => void,
	) => Promise<Component>;
}

export interface IntegrationBundle {
	toolUI: IntegrationToolUI | undefined;
}

export async function loadIntegrationBundle(frontendUrl: string): Promise<IntegrationBundle> {
	const mod = await loadBundle(frontendUrl);
	return {toolUI: mod.toolUI as IntegrationToolUI | undefined};
}
