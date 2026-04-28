import * as p from '@clack/prompts';
import chalk from 'chalk';
import {spawn, exec as execCb} from 'node:child_process';
import {promisify} from 'node:util';
import {hostname} from 'node:os';
import {generateSecurityKey} from '@/server/api/auth';
import {
	registerGatewayWithApi,
	waitForManifest,
} from '@/server/api/gateways';
import {RAILWAY_TEMPLATE_CODE} from '@/templates/gateway-compose';
import {getConfig} from '@/config/index';

const exec = promisify(execCb);

async function commandExists(cmd: string): Promise<boolean> {
	try {
		await exec(`command -v ${cmd}`);
		return true;
	} catch {
		return false;
	}
}

async function railwayInstalled(): Promise<boolean> {
	return commandExists('railway');
}

async function offerRailwayInstall(): Promise<boolean> {
	p.log.info(
		`${chalk.bold('Railway CLI not found.')} See https://docs.railway.com/cli for install options.`,
	);

	const useBrew = process.platform === 'darwin' && (await commandExists('brew'));
	const installer = useBrew
		? {label: 'brew install railway', cmd: 'brew', args: ['install', 'railway']}
		: {label: 'npm install -g @railway/cli', cmd: 'npm', args: ['install', '-g', '@railway/cli']};

	const proceed = await p.confirm({
		message: `Install with \`${installer.label}\`?`,
		initialValue: true,
	});
	if (p.isCancel(proceed) || !proceed) return false;

	return new Promise(resolve => {
		const child = spawn(installer.cmd, installer.args, {stdio: 'inherit'});
		child.on('exit', code => resolve(code === 0));
		child.on('error', () => resolve(false));
	});
}

async function railwayWhoami(): Promise<{loggedIn: boolean; user?: string}> {
	try {
		const {stdout} = await exec('railway whoami');
		const trimmed = stdout.trim();
		if (!trimmed) return {loggedIn: false};
		return {loggedIn: true, user: trimmed};
	} catch {
		return {loggedIn: false};
	}
}

async function railwayLogin(browserless: boolean): Promise<boolean> {
	return new Promise(resolve => {
		const args = browserless ? ['login', '--browserless'] : ['login'];
		const child = spawn('railway', args, {stdio: 'inherit'});
		child.on('exit', code => resolve(code === 0));
		child.on('error', () => resolve(false));
	});
}

interface RailwayInitOptions {
	projectName: string;
}

async function railwayInit(opts: RailwayInitOptions): Promise<boolean> {
	return new Promise(resolve => {
		const child = spawn('railway', ['init', '--name', opts.projectName], {stdio: 'inherit'});
		child.on('exit', code => resolve(code === 0));
		child.on('error', () => resolve(false));
	});
}

async function railwayDeployTemplate(args: {
	templateCode: string;
	variables: Record<string, string>;
}): Promise<boolean> {
	const flags: string[] = ['deploy', '-t', args.templateCode];
	for (const [k, v] of Object.entries(args.variables)) {
		if (v !== undefined && v !== '') flags.push('-v', `${k}=${v}`);
	}
	return new Promise(resolve => {
		const child = spawn('railway', flags, {stdio: 'inherit'});
		child.on('exit', code => resolve(code === 0));
		child.on('error', () => resolve(false));
	});
}

async function railwayProvisionDomain(): Promise<string | null> {
	try {
		const {stdout} = await exec('railway domain');
		const match = stdout.match(/https?:\/\/[^\s]+/);
		return match ? match[0].replace(/[).,\]]+$/, '') : null;
	} catch {
		return null;
	}
}

interface RailwaySetupResult {
	gatewayId: string;
	baseUrl: string;
}

export async function setupRailwayGateway(): Promise<RailwaySetupResult | {cancelled: true}> {
	const config = getConfig();
	if (!config.auth?.apiKey || !config.auth?.url) {
		throw new Error('Not authenticated. Run `corebrain login` first.');
	}

	p.log.info(
		chalk.dim('Railway is paid — this will spin up a service Railway bills you for.'),
	);

	if (!(await railwayInstalled())) {
		const installed = await offerRailwayInstall();
		if (!installed) {
			p.log.error('Railway CLI is required. Install it and re-run setup.');
			return {cancelled: true};
		}
		if (!(await railwayInstalled())) {
			p.log.error('Railway CLI still not on PATH after install. Re-open your shell and try again.');
			return {cancelled: true};
		}
	}

	const auth = await railwayWhoami();
	if (!auth.loggedIn) {
		const isTty = Boolean(process.stdout.isTTY);
		const browserless = !isTty;
		p.log.step(
			browserless
				? 'Logging in to Railway (browserless — copy the code into your browser).'
				: 'Logging in to Railway (will open your browser).',
		);
		const ok = await railwayLogin(browserless);
		if (!ok) {
			p.log.error('Railway login failed.');
			return {cancelled: true};
		}
	} else {
		p.log.info(`Railway logged in as ${chalk.cyan(auth.user ?? 'unknown')}.`);
	}

	const name = await p.text({
		message: 'Gateway name (also used as the Railway project name)',
		placeholder: `${hostname()}-railway`,
		initialValue: `${hostname()}-railway`,
		validate: v => (v?.trim() ? undefined : 'Name is required'),
	});
	if (p.isCancel(name)) return {cancelled: true};

	const description = await p.text({
		message: 'Description (optional)',
		placeholder: 'Cloud-hosted CoreBrain gateway',
		defaultValue: '',
	});
	if (p.isCancel(description)) return {cancelled: true};

	const claudeToken = await p.text({
		message: chalk.dim('CLAUDE_CODE_OAUTH_TOKEN (optional)'),
		placeholder: 'Leave blank to skip',
		defaultValue: '',
	});
	if (p.isCancel(claudeToken)) return {cancelled: true};

	const openaiKey = await p.text({
		message: chalk.dim('OPENAI_API_KEY (optional)'),
		placeholder: 'Leave blank to skip',
		defaultValue: '',
	});
	if (p.isCancel(openaiKey)) return {cancelled: true};

	const githubToken = await p.text({
		message: chalk.dim('GITHUB_TOKEN (optional)'),
		placeholder: 'Leave blank to skip',
		defaultValue: '',
	});
	if (p.isCancel(githubToken)) return {cancelled: true};

	const initSpinner = p.spinner();
	initSpinner.stop();
	p.log.step(`Creating Railway project ${chalk.cyan(name as string)}...`);
	const initOk = await railwayInit({projectName: name as string});
	if (!initOk) {
		p.log.error('`railway init` failed.');
		return {cancelled: true};
	}

	const securityKey = generateSecurityKey();

	const variables: Record<string, string> = {
		COREBRAIN_API_URL: config.auth.url,
		COREBRAIN_API_KEY: config.auth.apiKey,
		COREBRAIN_GATEWAY_NAME: name as string,
		COREBRAIN_GATEWAY_DESCRIPTION: (description as string) || 'Cloud-hosted CoreBrain gateway',
		COREBRAIN_GATEWAY_SECURITY_KEY: securityKey,
		CLAUDE_CODE_OAUTH_TOKEN: (claudeToken as string) || '',
		OPENAI_API_KEY: (openaiKey as string) || '',
		GITHUB_TOKEN: (githubToken as string) || '',
	};

	p.log.step(`Deploying template ${chalk.cyan(RAILWAY_TEMPLATE_CODE)} to Railway...`);
	const deployOk = await railwayDeployTemplate({
		templateCode: RAILWAY_TEMPLATE_CODE,
		variables,
	});
	if (!deployOk) {
		p.log.error('`railway deploy` failed.');
		return {cancelled: true};
	}

	const domainSpinner = p.spinner();
	domainSpinner.start('Provisioning Railway domain...');
	const baseUrl = await railwayProvisionDomain();
	if (!baseUrl) {
		domainSpinner.stop(chalk.red('Could not parse domain from `railway domain`'));
		p.log.info(
			'Run `railway domain` manually in the project dir, then re-run `corebrain gateway setup` to register.',
		);
		return {cancelled: true};
	}
	domainSpinner.stop(chalk.green(`Domain: ${baseUrl}`));

	const waitSpinner = p.spinner();
	waitSpinner.start(`Waiting for ${baseUrl}/manifest...`);
	const reachable = await waitForManifest(baseUrl, securityKey, 180_000, 3_000);
	if (!reachable) {
		waitSpinner.stop(chalk.red('Gateway did not respond within 3 minutes'));
		p.log.info('Check Railway logs and try registering manually with `corebrain gateway register`.');
		return {cancelled: true};
	}
	waitSpinner.stop(chalk.green('Gateway is reachable'));

	const addToCore = await p.confirm({
		message: `Add this gateway to CORE (${baseUrl})?`,
		initialValue: true,
	});
	if (p.isCancel(addToCore) || !addToCore) {
		p.note(
			[
				`Railway service running at ${baseUrl}.`,
				`Security key: ${chalk.yellow(securityKey)}`,
				'',
				'Register later via Settings → Gateways → Register.',
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
			baseUrl,
			securityKey,
			name: name as string,
			description: (description as string) || undefined,
		});
		gatewayId = result.gatewayId;
		regSpinner.stop(chalk.green('Registered'));
	} catch (err) {
		regSpinner.stop(chalk.red('Registration failed'));
		throw err;
	}

	p.note(
		[
			`${chalk.bold('Gateway:')}    ${name}`,
			`${chalk.bold('URL:')}        ${baseUrl}`,
			`${chalk.bold('Gateway ID:')} ${gatewayId}`,
			'',
			chalk.dim('Manage the deploy via the Railway dashboard or `railway` CLI in the project dir.'),
		].join('\n'),
		'Railway gateway ready',
	);

	return {gatewayId, baseUrl};
}
