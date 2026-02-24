import {useEffect} from 'react';
import {useApp} from 'ink';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import zod from 'zod';
import {
	setBrowserExecutable,
	getBrowserExecutable,
	detectAvailableBrowsers,
	detectBravePath,
	detectChromePath,
} from '@/utils/agent-browser';
import type {BrowserType} from '@/types/config';

export const args = zod
	.tuple([
		zod.enum(['default', 'brave', 'chrome', 'custom']).describe('Browser type'),
	])
	.rest(zod.string().describe('Custom path (required for custom type)'));

export const options = zod.object({});

type Props = {
	args: zod.infer<typeof args>;
	options: zod.infer<typeof options>;
};

async function runSetBrowser(
	browserType: BrowserType,
	customPath?: string,
): Promise<void> {
	const spinner = p.spinner();

	// Show current config
	const current = getBrowserExecutable();
	p.log.info(
		`Current: ${current.type}${current.path ? ` (${current.path})` : ''}`,
	);

	// If setting to brave/chrome, show detected path
	if (browserType === 'brave') {
		const path = detectBravePath();
		if (path) {
			p.log.info(`Detected Brave: ${path}`);
		}
	} else if (browserType === 'chrome') {
		const path = detectChromePath();
		if (path) {
			p.log.info(`Detected Chrome: ${path}`);
		}
	}

	spinner.start(`Setting browser to ${browserType}...`);

	const result = setBrowserExecutable(browserType, customPath);

	if (!result.success) {
		spinner.stop(chalk.red('Failed'));
		p.log.error(result.error || 'Failed to set browser');
		return;
	}

	const newConfig = getBrowserExecutable();
	spinner.stop(chalk.green(`Browser set to ${newConfig.type}`));

	if (newConfig.path) {
		p.log.info(`Executable: ${newConfig.path}`);
	}
}

async function runInteractive(): Promise<void> {
	const current = getBrowserExecutable();
	p.log.info(
		`Current: ${current.type}${current.path ? ` (${current.path})` : ''}`,
	);

	// Detect available browsers
	const available = detectAvailableBrowsers();

	const options: {value: BrowserType; label: string; hint?: string}[] = [
		{value: 'default', label: 'Default', hint: 'System default browser'},
	];

	for (const browser of available) {
		options.push({
			value: browser.type,
			label: browser.type.charAt(0).toUpperCase() + browser.type.slice(1),
			hint: browser.path,
		});
	}

	options.push({value: 'custom', label: 'Custom', hint: 'Specify custom path'});

	const selected = await p.select({
		message: 'Select browser:',
		options,
		initialValue: current.type,
	});

	if (p.isCancel(selected)) {
		p.log.info('Cancelled');
		return;
	}

	let customPath: string | undefined;
	if (selected === 'custom') {
		const path = await p.text({
			message: 'Enter browser executable path:',
			placeholder: '/path/to/browser',
			validate: value => {
				if (value && !value.trim()) return 'Path is required';
			},
		});

		if (p.isCancel(path)) {
			p.log.info('Cancelled');
			return;
		}

		customPath = path;
	}

	await runSetBrowser(selected as BrowserType, customPath);
}

export default function BrowserSetBrowser({
	args: [browserType, ...rest],
}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		const run = async () => {
			if (!browserType) {
				// Interactive mode
				await runInteractive();
			} else {
				// Direct mode
				const customPath = browserType === 'custom' ? rest[0] : undefined;
				await runSetBrowser(browserType, customPath);
			}
		};

		run()
			.catch(err => {
				p.log.error(
					`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
				);
			})
			.finally(() => {
				setTimeout(() => exit(), 100);
			});
	}, [browserType, rest, exit]);

	return null;
}
