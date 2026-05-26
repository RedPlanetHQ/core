import React from 'react';
import {Box, Text, useApp} from 'ink';
import {getPreferences} from '@/config/preferences';
import {resolveWorkflows} from '@/server/workflows/resolver';
import {
	detectPluginSkills,
	detectSuperpowersPresent,
} from '@/server/workflows/detect';
import {listSkills} from '@/server/skills/skill-store';

export default function Show() {
	const {exit} = useApp();
	const [out, setOut] = React.useState<string | null>(null);

	React.useEffect(() => {
		(async () => {
			const prefs = getPreferences();
			const agents = Object.keys(prefs.coding ?? {});
			const skills = await listSkills();
			const pluginSkills = agents.flatMap((a) => detectPluginSkills(a));
			const resolved = resolveWorkflows({
				prefs,
				agentsConfigured: agents,
				pluginSkills,
				skills,
				superpowersPresent: detectSuperpowersPresent(),
			});

			const lines: string[] = [];
			lines.push(`source: ${resolved.source}`);
			for (const [agent, tracks] of Object.entries(resolved.perAgent)) {
				lines.push('');
				lines.push(`agent: ${agent}`);
				for (const trackName of ['bug', 'feature'] as const) {
					const t = tracks[trackName];
					lines.push(`  ${trackName}:`);
					for (const phase of t.phases) {
						lines.push(
							`    - ${phase.name}  (poll ${phase.pollSeconds}s, ${phase.advanceOn})`,
						);
					}
				}
				if (tracks.unresolved.length > 0) {
					lines.push(`  unresolved: ${tracks.unresolved.join(', ')}`);
				}
			}
			setOut(lines.join('\n'));
			setTimeout(() => exit(), 0);
		})();
	}, [exit]);

	if (!out) return <Text>resolving…</Text>;
	return (
		<Box flexDirection="column">
			<Text>{out}</Text>
		</Box>
	);
}
