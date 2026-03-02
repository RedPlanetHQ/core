import zod from 'zod';
import type {GatewayTool} from './browser-tools';

// ============ Zod Schemas ============

export const SleepSchema = zod.object({
	seconds: zod.number().min(1).max(300),
	reason: zod.string().optional(),
});

// ============ Tool Definitions ============

export const utilsTools: GatewayTool[] = [
	{
		name: 'sleep',
		description:
			'Pause execution for the given number of seconds (1–300). Use this to wait between polling operations, e.g. after starting a coding session before reading its output.',
		inputSchema: {
			type: 'object',
			properties: {
				seconds: {
					type: 'number',
					description: 'Number of seconds to sleep (1–300)',
				},
				reason: {
					type: 'string',
					description: 'Optional reason for sleeping (for logging)',
				},
			},
			required: ['seconds'],
		},
	},
];

// ============ Tool Handlers ============

async function handleSleep(params: zod.infer<typeof SleepSchema>) {
	await new Promise<void>(resolve => setTimeout(resolve, params.seconds * 1000));
	return {
		success: true,
		result: {
			slept: params.seconds,
			...(params.reason ? {reason: params.reason} : {}),
		},
	};
}

// ============ Tool Execution ============

export async function executeUtilsTool(
	toolName: string,
	params: Record<string, unknown>,
): Promise<{success: boolean; result?: unknown; error?: string}> {
	try {
		switch (toolName) {
			case 'sleep':
				return await handleSleep(SleepSchema.parse(params));

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
