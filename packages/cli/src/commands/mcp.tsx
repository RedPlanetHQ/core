import React, { useEffect } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { startMCPServer } from '../mcp-server';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

export default function Mcp(_props: Props) {
	useEffect(() => {
		// Start MCP server immediately
		startMCPServer().catch((error) => {
			console.error('Failed to start MCP server:', error);
			process.exit(1);
		});
	}, []);

	// This component won't actually render anything visible
	// because the MCP server takes over stdio
	return <Text dimColor>MCP server starting...</Text>;
}
