import * as p from '@clack/prompts';
import chalk from 'chalk';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {exec as execCb, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {
	PROVIDER_SPECS,
	type ChatProvider,
	type ProviderSpec,
} from '@redplanethq/sdk';
import {applyEnvOverrides} from '@/templates/env-overrides';
import {
	fetchWebappComposeYaml,
	fetchWebappEnvExample,
} from '@/templates/webapp-compose';

const exec = promisify(execCb);

async function commandExists(cmd: string): Promise<boolean> {
	try {
		await exec(`command -v ${cmd}`);
		return true;
	} catch {
		return false;
	}
}

async function dockerComposeUp(dir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('docker', ['compose', 'up', '-d'], {
			cwd: dir,
			stdio: 'inherit',
		});
		child.on('exit', code => {
			if (code === 0) resolve();
			else reject(new Error(`docker compose up exited with code ${code}`));
		});
		child.on('error', reject);
	});
}

interface LocalSetupResult {
	installDir: string;
	appOrigin: string;
}

interface ProviderAnswers {
	provider: ChatProvider;
	chatModel: string;
	apiKey?: string;
	baseUrl?: string;
	/** OpenAI-only: "responses" (default) | "chat_completions" (most proxies). */
	openaiApiMode?: 'responses' | 'chat_completions';
}

async function promptProvider(): Promise<ProviderAnswers | {cancelled: true}> {
	const provider = await p.select({
		message: 'Which AI provider?',
		options: Object.values(PROVIDER_SPECS)
			.filter(s => s.serverDefault)
			.map(s => ({
				value: s.id,
				label: s.label,
			})),
		initialValue: 'openai' as ChatProvider,
	});
	if (p.isCancel(provider)) return {cancelled: true};
	const spec: ProviderSpec = PROVIDER_SPECS[provider as ChatProvider];

	let apiKey: string | undefined;
	if (spec.apiKeyVar) {
		const k = await p.text({
			message: `${spec.label} API key`,
			placeholder: 'Paste your API key',
			validate: v => (v?.trim() ? undefined : 'API key is required'),
		});
		if (p.isCancel(k)) return {cancelled: true};
		apiKey = (k as string).trim();
	}

	let baseUrl: string | undefined;
	if (spec.baseUrl) {
		const required = spec.baseUrl.required;
		// Show the hint BEFORE the prompt so users know what they're being asked.
		if (spec.baseUrl.hint) p.log.info(chalk.dim(spec.baseUrl.hint));
		const message = required
			? `${spec.baseUrl.var} (required)`
			: `${spec.baseUrl.var} (optional — leave blank for default)`;
		const u = await p.text({
			message,
			placeholder: spec.baseUrl.placeholder,
			defaultValue: '',
			validate: v => {
				const trimmed = (v ?? '').trim();
				if (!trimmed) return required ? 'URL is required' : undefined;
				return /^https?:\/\//.test(trimmed) ? undefined : 'URL must start with http:// or https://';
			},
		});
		if (p.isCancel(u)) return {cancelled: true};
		const trimmed = (u as string).trim();
		if (trimmed) baseUrl = trimmed;
	}

	// OpenAI proxy: when OPENAI_BASE_URL is set, the provider is almost always
	// an OpenAI-compatible proxy (Together, Groq via /v1, vLLM, LiteLLM, etc.)
	// and many of those don't speak the new responses API. Ask which mode.
	let openaiApiMode: 'responses' | 'chat_completions' | undefined;
	if (provider === 'openai' && baseUrl) {
		const mode = await p.select({
			message: 'OpenAI API mode',
			options: [
				{
					value: 'chat_completions',
					label: 'chat_completions',
					hint: 'most OpenAI-compatible proxies',
				},
				{
					value: 'responses',
					label: 'responses',
					hint: 'OpenAI direct, or proxies that explicitly support /v1/responses',
				},
			],
			initialValue: 'chat_completions',
		});
		if (p.isCancel(mode)) return {cancelled: true};
		openaiApiMode = mode as 'responses' | 'chat_completions';
	}

	const chatModel = await p.text({
		message: 'Chat model',
		placeholder: spec.defaultChatModel,
		initialValue: spec.defaultChatModel,
		validate: v => (v?.trim() ? undefined : 'Model is required'),
	});
	if (p.isCancel(chatModel)) return {cancelled: true};

	return {
		provider: provider as ChatProvider,
		chatModel: (chatModel as string).trim(),
		apiKey,
		baseUrl,
		openaiApiMode,
	};
}

export async function setupLocalWebapp(): Promise<LocalSetupResult | {cancelled: true}> {
	if (!(await commandExists('docker'))) {
		throw new Error(
			'`docker` not found on PATH. Install Docker Desktop (or the docker engine) and retry.',
		);
	}

	const installDirRaw = await p.text({
		message: 'Install directory',
		placeholder: join(homedir(), '.corebrain', 'self-host'),
		initialValue: join(homedir(), '.corebrain', 'self-host'),
	});
	if (p.isCancel(installDirRaw)) return {cancelled: true};
	const installDir = (installDirRaw as string).trim();

	const answers = await promptProvider();
	if ('cancelled' in answers) return {cancelled: true};

	if (existsSync(installDir)) {
		const overwrite = await p.confirm({
			message: `${installDir} already exists. Overwrite docker-compose.yaml + .env?`,
			initialValue: false,
		});
		if (p.isCancel(overwrite) || !overwrite) return {cancelled: true};
	}
	mkdirSync(installDir, {recursive: true});

	const fetchSpinner = p.spinner();
	fetchSpinner.start('Fetching docker-compose.yaml + .env.example from GitHub...');
	let composeYaml: string;
	let envExample: string;
	try {
		[composeYaml, envExample] = await Promise.all([
			fetchWebappComposeYaml(),
			fetchWebappEnvExample(),
		]);
		fetchSpinner.stop(chalk.green('Fetched templates'));
	} catch (err) {
		fetchSpinner.stop(chalk.red('Could not fetch templates'));
		throw err;
	}

	const sessionSecret = randomBytes(16).toString('hex');
	const encryptionKey = randomBytes(16).toString('hex');
	const magicLinkSecret = randomBytes(16).toString('hex');
	const neo4jPassword = randomBytes(12).toString('hex');

	const spec = PROVIDER_SPECS[answers.provider];
	const overrides: Record<string, string | undefined> = {
		SESSION_SECRET: sessionSecret,
		ENCRYPTION_KEY: encryptionKey,
		MAGIC_LINK_SECRET: magicLinkSecret,
		NEO4J_PASSWORD: neo4jPassword,
		NEO4J_AUTH: `neo4j/${neo4jPassword}`,
		CHAT_PROVIDER: answers.provider,
		MODEL: answers.chatModel,
	};
	if (spec.apiKeyVar && answers.apiKey) overrides[spec.apiKeyVar] = answers.apiKey;
	if (spec.baseUrl && answers.baseUrl) overrides[spec.baseUrl.var] = answers.baseUrl;
	if (answers.openaiApiMode) overrides.OPENAI_API_MODE = answers.openaiApiMode;

	const envFile = applyEnvOverrides(envExample, overrides);

	writeFileSync(join(installDir, 'docker-compose.yaml'), composeYaml, 'utf-8');
	writeFileSync(join(installDir, '.env'), envFile, 'utf-8');
	p.log.success(`Wrote ${installDir}/{docker-compose.yaml,.env}`);
	p.log.info(
		chalk.dim(
			`Edit ${installDir}/.env for advanced settings (Google OAuth, email transport, embedding model, etc.).`,
		),
	);

	const startNow = await p.confirm({
		message: 'Start CORE now (`docker compose up -d`)?',
		initialValue: true,
	});
	if (p.isCancel(startNow) || !startNow) {
		p.note(
			[
				'Files are ready. To bring it up later:',
				`  cd ${installDir} && docker compose up -d`,
			].join('\n'),
			'Skipped',
		);
		return {cancelled: true};
	}

	const upSpinner = p.spinner();
	upSpinner.start('Starting CORE (this may pull several images)...');
	try {
		await dockerComposeUp(installDir);
		upSpinner.stop(chalk.green('Containers are up'));
	} catch (err) {
		upSpinner.stop(chalk.red('docker compose up failed'));
		throw err;
	}

	const appOrigin = 'http://localhost:3033';

	p.note(
		[
			`${chalk.bold('CORE is running at:')} ${appOrigin}`,
			'',
			`${chalk.dim('Logs:')}  cd ${installDir} && docker compose logs -f core`,
			`${chalk.dim('Stop:')}  cd ${installDir} && docker compose down`,
			'',
			`Point this CLI at your local instance:`,
			`  corebrain login  ${chalk.dim(`# enter ${appOrigin} as the instance URL`)}`,
		].join('\n'),
		'Local CORE ready',
	);

	return {installDir, appOrigin};
}
