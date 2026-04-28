import * as p from '@clack/prompts';
import chalk from 'chalk';
import {getPreferences} from '@/config/preferences';

/**
 * Bail out of a command that only makes sense when this machine runs a native
 * gateway (folder / browser / coding / exec). Returns true when the caller
 * should continue, false (after printing an error + setting exitCode=1) when
 * the caller should return immediately.
 *
 * Single source for the redirect message — change here, every gated command
 * stays consistent.
 */
export function requireNativeGateway(): boolean {
	const prefs = getPreferences();
	if (prefs.gateway?.id) return true;

	p.log.error('No native gateway on this machine.');
	p.log.info(
		`Run ${chalk.cyan('corebrain gateway setup --kind native')} first, or manage a remote gateway via the CORE webapp.`,
	);
	process.exitCode = 1;
	return false;
}
