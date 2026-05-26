import React from 'react';
import {Box, Text, useApp} from 'ink';
import zod from 'zod';
import {getPreferences, updatePreferences} from '@/config/preferences';

export const options = zod.object({
	agent: zod
		.string()
		.optional()
		.describe('Reset only this agent. Omit to clear all overrides.'),
});

type Props = {options: zod.infer<typeof options>};

export default function Reset({options}: Props) {
	const {exit} = useApp();
	const [out, setOut] = React.useState<string>('resetting…');

	React.useEffect(() => {
		const prefs = getPreferences();
		const cw = prefs.codingWorkflows ?? {};
		if (options.agent) {
			delete cw[options.agent];
			updatePreferences({codingWorkflows: cw});
			setOut(`cleared codingWorkflows.${options.agent}`);
		} else {
			updatePreferences({codingWorkflows: undefined});
			setOut('cleared all codingWorkflows overrides');
		}
		setTimeout(() => exit(), 0);
	}, [exit, options.agent]);

	return (
		<Box flexDirection="column">
			<Text>{out}</Text>
		</Box>
	);
}
