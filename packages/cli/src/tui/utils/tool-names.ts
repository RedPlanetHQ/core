const DISPLAY_NAMES: Record<string, string> = {
	gather_context: 'Gather context',
	take_action: 'Take action',
	integration_query: 'Integration explorer',
	integration_action: 'Integration explorer',
	memory_search: 'Memory search',
	execute_integration_action: 'Execute action',
	get_integration_actions: 'Get actions',
};

export function getToolDisplayName(toolName: string): string {
	if (DISPLAY_NAMES[toolName]) return DISPLAY_NAMES[toolName];
	if (toolName.startsWith('gateway_')) {
		return 'Sub-agent: ' + toolName.replace('gateway_', '').replace(/_/g, ' ');
	}

	return toolName.replace(/_/g, ' ');
}
