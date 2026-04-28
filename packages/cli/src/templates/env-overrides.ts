/**
 * Apply a small set of overrides to a `.env.example` file fetched from the
 * repo. Keeps the example's comments + advanced flags intact so users can
 * discover what's available by reading their generated `.env` directly.
 *
 * For each override:
 *  - If the key already appears as `KEY=` (or `# KEY=` commented) on a line,
 *    replace that line with the new value (uncommenting if needed).
 *  - Otherwise append `KEY=value` at the bottom.
 *
 * Set a value to `undefined` to skip the override entirely (don't touch the
 * line, don't append).
 */

function escapeEnvValue(v: string): string {
	if (v === '') return '';
	if (/[\s"$#]/.test(v)) {
		return `"${v.replace(/(["\\$])/g, '\\$1')}"`;
	}
	return v;
}

export function applyEnvOverrides(
	envText: string,
	overrides: Record<string, string | undefined>,
): string {
	let result = envText;
	for (const [key, raw] of Object.entries(overrides)) {
		if (raw === undefined) continue;
		const newLine = `${key}=${escapeEnvValue(raw)}`;
		const re = new RegExp(`^[ \\t]*#?[ \\t]*${key}=.*$`, 'm');
		if (re.test(result)) {
			result = result.replace(re, newLine);
		} else {
			if (!result.endsWith('\n')) result += '\n';
			result += newLine + '\n';
		}
	}
	return result;
}
