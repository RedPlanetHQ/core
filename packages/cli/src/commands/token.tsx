import { useEffect } from 'react';
import { useApp } from 'ink';
import * as p from '@clack/prompts';
import zod from 'zod';
import { getConfig } from '@/config/index';

export const options = zod.object({});

type Props = {
	options: zod.infer<typeof options>;
};

async function runToken(): Promise<void> {
	const config = getConfig();
	const apiKey = config.auth?.apiKey;

	if (!apiKey) {
		p.log.error('Not authenticated. Please run the login command first.');
		return;
	}

	// Just output the token directly for piping/scripting
	console.log(apiKey);
}

export default function Token(_props: Props) {
	const { exit } = useApp();

	useEffect(() => {
		runToken().finally(() => {
			setTimeout(() => exit(), 100);
		});
	}, [exit]);

	return null;
}
