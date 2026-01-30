import { useEffect, useState } from 'react';
import { Text } from 'ink';
import zod from 'zod';
import { startGatewayServer } from '@/server/gateway';

const DEFAULT_PORT = 3456;

export const options = zod.object({
	port: zod.number().optional().describe('Port for the gateway server'),
});

type Props = {
	options: zod.infer<typeof options>;
};

export default function Server({ options }: Props) {
	const [status, setStatus] = useState<'starting' | 'running' | 'error'>('starting');
	const [error, setError] = useState('');
	const port = options.port || DEFAULT_PORT;

	useEffect(() => {
		let cancelled = false;
		let server: any = null;

		(async () => {
			try {
				const result = await startGatewayServer(port);
				server = result.server;

				if (!cancelled) {
					setStatus('running');
				}

				// Handle graceful shutdown
				const shutdown = () => {
					if (server) {
						server.close(() => {
							process.exit(0);
						});
					} else {
						process.exit(0);
					}
				};

				process.on('SIGTERM', shutdown);
				process.on('SIGINT', shutdown);

			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : 'Unknown error');
					setStatus('error');
				}
			}
		})();

		return () => {
			cancelled = true;
			if (server) {
				server.close();
			}
		};
	}, [port]);

	if (status === 'starting') {
		return <Text dimColor>Starting gateway server on port {port}...</Text>;
	}

	if (status === 'error') {
		return <Text color="red">Error: {error}</Text>;
	}

	return (
		<>
			<Text color="green">Gateway server running on port {port}</Text>
			<Text dimColor>PID: {process.pid}</Text>
			<Text dimColor>Press Ctrl+C to stop</Text>
		</>
	);
}
