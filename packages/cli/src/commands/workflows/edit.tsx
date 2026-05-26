import React from 'react';
import {Box, Text, useApp} from 'ink';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {getConfigPath} from '@/config/paths';

export default function Edit() {
	const {exit} = useApp();
	const [status, setStatus] = React.useState<string>('opening editor…');

	React.useEffect(() => {
		const editor = process.env.EDITOR || process.env.VISUAL || 'nano';
		const configPath = join(getConfigPath(), 'config.json');
		const child = spawn(editor, [configPath], {
			stdio: 'inherit',
		});
		child.on('exit', (code) => {
			setStatus(
				code === 0
					? `saved. run \`corebrain workflows show\` to see what resolved.`
					: `editor exited ${code}`,
			);
			setTimeout(() => exit(), 0);
		});
	}, [exit]);

	return (
		<Box flexDirection="column">
			<Text>{status}</Text>
		</Box>
	);
}
