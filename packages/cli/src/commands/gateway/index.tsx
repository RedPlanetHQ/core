export const description = [
	'Manage the local CORE gateway service.',
	'',
	'Related commands (require a native gateway to be set up first):',
	'  corebrain folder       Register and scope folders the gateway can touch',
	'  corebrain browser      Configure the gateway browser + sessions',
	'  corebrain coding       Configure coding agents (claude-code, codex)',
	'  corebrain exec         Configure exec slot allow/deny patterns',
].join('\n');

export default function Gateway() {
	return null;
}
