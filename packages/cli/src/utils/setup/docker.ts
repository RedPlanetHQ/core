import * as p from '@clack/prompts';
import chalk from 'chalk';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {homedir, hostname} from 'node:os';
import {join} from 'node:path';
import {exec as execCb, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {generateSecurityKey} from '@/server/api/auth';
import {
	registerGatewayWithApi,
	waitForManifest,
} from '@/server/api/gateways';
import {startTailscaleFunnel} from '@/server/api/tunnels/tailscale';
import {
	fetchGatewayComposeYaml,
	fetchGatewayEnvExample,
} from '@/templates/gateway-compose';
import {applyEnvOverrides} from '@/templates/env-overrides';
import {getConfig} from '@/config/index';

const exec = promisify(execCb);

function safeDirName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'gateway';
}

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

interface DockerSetupResult {
	gatewayId: string;
	baseUrl: string;
	composeDir: string;
}

export async function setupDockerGateway(): Promise<DockerSetupResult | {cancelled: true}> {
	const config = getConfig();
	if (!config.auth?.apiKey || !config.auth?.url) {
		throw new Error('Not authenticated. Run `corebrain login` first.');
	}

	if (!(await commandExists('docker'))) {
		throw new Error(
			'`docker` not found on PATH. Install Docker Desktop (or the docker engine) and retry.',
		);
	}

	const name = await p.text({
		message: 'Gateway name',
		placeholder: `${hostname()}-docker`,
		initialValue: `${hostname()}-docker`,
		validate: v => (v?.trim() ? undefined : 'Name is required'),
	});
	if (p.isCancel(name)) return {cancelled: true};

	const description = await p.text({
		message: 'Description (optional)',
		placeholder: 'Cloud-hosted CoreBrain gateway',
		defaultValue: '',
	});
	if (p.isCancel(description)) return {cancelled: true};

	const port = 7787;

	const claudeToken = await p.text({
		message: chalk.dim('CLAUDE_CODE_OAUTH_TOKEN (optional — from `claude setup-token`)'),
		placeholder: 'Leave blank to skip',
		defaultValue: '',
	});
	if (p.isCancel(claudeToken)) return {cancelled: true};

	const openaiKey = await p.text({
		message: chalk.dim('OPENAI_API_KEY (optional — for codex-cli)'),
		placeholder: 'Leave blank to skip',
		defaultValue: '',
	});
	if (p.isCancel(openaiKey)) return {cancelled: true};

	const githubToken = await p.text({
		message: chalk.dim('GITHUB_TOKEN (optional — for git clone of private repos)'),
		placeholder: 'Leave blank to skip',
		defaultValue: '',
	});
	if (p.isCancel(githubToken)) return {cancelled: true};

	const dirName = safeDirName(name as string);
	const composeDir = join(homedir(), '.corebrain', 'gateways', dirName);
	if (existsSync(composeDir)) {
		const overwrite = await p.confirm({
			message: `${composeDir} already exists. Overwrite docker-compose.yaml + .env?`,
			initialValue: false,
		});
		if (p.isCancel(overwrite) || !overwrite) return {cancelled: true};
	}
	mkdirSync(composeDir, {recursive: true});

	const securityKey = generateSecurityKey();

	const fetchSpinner = p.spinner();
	fetchSpinner.start('Fetching docker-compose.yaml + .env.example from GitHub...');
	let composeYaml: string;
	let envExample: string;
	try {
		[composeYaml, envExample] = await Promise.all([
			fetchGatewayComposeYaml(),
			fetchGatewayEnvExample(),
		]);
		fetchSpinner.stop(chalk.green('Fetched templates'));
	} catch (err) {
		fetchSpinner.stop(chalk.red('Could not fetch templates'));
		throw err;
	}

	const overrides: Record<string, string | undefined> = {
		COREBRAIN_API_URL: config.auth.url,
		COREBRAIN_API_KEY: config.auth.apiKey,
		COREBRAIN_GATEWAY_NAME: name as string,
		COREBRAIN_GATEWAY_SECURITY_KEY: securityKey,
		COREBRAIN_GATEWAY_HTTP_PORT: String(port),
	};
	if ((description as string)?.trim()) {
		overrides.COREBRAIN_GATEWAY_DESCRIPTION = (description as string).trim();
	}
	if ((claudeToken as string)?.trim()) {
		overrides.CLAUDE_CODE_OAUTH_TOKEN = (claudeToken as string).trim();
	}
	if ((openaiKey as string)?.trim()) {
		overrides.OPENAI_API_KEY = (openaiKey as string).trim();
	}
	if ((githubToken as string)?.trim()) {
		overrides.GITHUB_TOKEN = (githubToken as string).trim();
	}

	const envFile = applyEnvOverrides(envExample, overrides);

	writeFileSync(join(composeDir, 'docker-compose.yaml'), composeYaml, 'utf-8');
	writeFileSync(join(composeDir, '.env'), envFile, 'utf-8');
	p.log.success(`Wrote ${composeDir}/{docker-compose.yaml,.env}`);

	const startNow = await p.confirm({
		message: 'Start the gateway container now (`docker compose up -d`)?',
		initialValue: true,
	});
	if (p.isCancel(startNow) || !startNow) {
		p.note(
			[
				'Files are ready. To bring it up later:',
				`  cd ${composeDir} && docker compose up -d`,
				'',
				`Then re-run ${chalk.cyan('corebrain gateway setup')} to register it,`,
				`or register manually with the security key in ${composeDir}/.env`,
			].join('\n'),
			'Skipped',
		);
		return {cancelled: true};
	}

	const upSpinner = p.spinner();
	upSpinner.start('Starting container (this may pull the image)...');
	try {
		await dockerComposeUp(composeDir);
		upSpinner.stop(chalk.green('Container is up'));
	} catch (err) {
		upSpinner.stop(chalk.red('docker compose up failed'));
		throw err;
	}

	const localUrl = `http://localhost:${port}`;
	const waitSpinner = p.spinner();
	waitSpinner.start(`Waiting for gateway manifest at ${localUrl}/manifest...`);
	const reachable = await waitForManifest(localUrl, securityKey, 90_000);
	if (!reachable) {
		waitSpinner.stop(chalk.red('Gateway did not respond within 90s'));
		throw new Error(
			`Container is up but /manifest never returned 200. Check logs: cd ${composeDir} && docker compose logs -f`,
		);
	}
	waitSpinner.stop(chalk.green('Gateway is reachable on localhost'));

	let publicBaseUrl = localUrl;
	const tailscaleAvailable = await commandExists('tailscale');
	const wantTunnel = await p.select({
		message: 'How should CORE reach this gateway?',
		options: [
			{
				value: 'tailscale',
				label: 'Tailscale funnel',
				hint: tailscaleAvailable
					? 'public HTTPS via your tailnet'
					: chalk.yellow('tailscale not on PATH — install first'),
			},
			{value: 'manual', label: 'I have my own public URL', hint: 'reverse proxy / Cloudflare tunnel / etc'},
			{value: 'localhost', label: 'localhost only', hint: 'CORE Cloud cannot reach this'},
		],
		initialValue: tailscaleAvailable ? 'tailscale' : 'manual',
	});
	if (p.isCancel(wantTunnel)) return {cancelled: true};

	if (wantTunnel === 'tailscale') {
		const tunnelSpinner = p.spinner();
		tunnelSpinner.start('Starting tailscale funnel...');
		try {
			const result = await startTailscaleFunnel(port);
			publicBaseUrl = result.url;
			tunnelSpinner.stop(chalk.green(`Tunnel up at ${publicBaseUrl}`));
		} catch (err) {
			tunnelSpinner.stop(chalk.red('Tailscale funnel failed'));
			throw err;
		}
	} else if (wantTunnel === 'manual') {
		const manual = await p.text({
			message: 'Public URL CORE should use to reach this gateway',
			placeholder: 'https://gateway.example.com',
			validate: v =>
				v && /^https?:\/\//.test(v.trim()) ? undefined : 'URL must start with http:// or https://',
		});
		if (p.isCancel(manual)) return {cancelled: true};
		publicBaseUrl = (manual as string).trim().replace(/\/$/, '');
	}

	const addToCore = await p.confirm({
		message: `Add this gateway to CORE (${publicBaseUrl})?`,
		initialValue: true,
	});
	if (p.isCancel(addToCore) || !addToCore) {
		p.note(
			[
				`Container running at ${localUrl} (public: ${publicBaseUrl}).`,
				'Register later via Settings → Gateways in the webapp,',
				`or with the security key in ${composeDir}/.env:`,
				`  ${chalk.yellow(securityKey)}`,
			].join('\n'),
			'Not registered',
		);
		return {cancelled: true};
	}

	const regSpinner = p.spinner();
	regSpinner.start('Registering with CORE...');
	let gatewayId: string;
	try {
		const result = await registerGatewayWithApi({
			baseUrl: publicBaseUrl,
			securityKey,
			name: name as string,
		});
		gatewayId = result.gatewayId;
		regSpinner.stop(chalk.green('Registered'));
	} catch (err) {
		regSpinner.stop(chalk.red('Registration failed'));
		throw err;
	}

	p.note(
		[
			`${chalk.bold('Gateway:')}     ${name}`,
			`${chalk.bold('Local URL:')}   ${localUrl}`,
			`${chalk.bold('Public URL:')}  ${publicBaseUrl}`,
			`${chalk.bold('Gateway ID:')}  ${gatewayId}`,
			`${chalk.bold('Compose dir:')} ${composeDir}`,
			'',
			`${chalk.dim('Logs:')} cd ${composeDir} && docker compose logs -f`,
			`${chalk.dim('Stop:')} cd ${composeDir} && docker compose down`,
		].join('\n'),
		'Docker gateway ready',
	);

	return {gatewayId, baseUrl: publicBaseUrl, composeDir};
}
