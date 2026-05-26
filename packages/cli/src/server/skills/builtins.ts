/**
 * First-party skills bundled with the CLI. Each entry's `skillMd` is the
 * full `SKILL.md` file (frontmatter + body) the daemon writes into
 * `~/.corebrain/skills/<name>/` on first boot — or any subsequent boot
 * where the directory is missing. There's no sentinel: the presence of
 * the skill directory IS the "already installed" check. If a user
 * deletes a builtin it will come back on the next daemon start; remove
 * the entry from this array if you want it gone permanently.
 */
export interface BuiltinSkill {
	name: string;
	skillMd: string;
}

const FIND_SKILLS = `---
name: find-skills
description: Find and install gateway skills from the corebrain library or skills.sh when none of the currently installed skills fit the task.
allowed-tools: [exec_command, load_skill]
---

# find-skills

Use this when the user's request doesn't clearly match any of the currently installed skills (listed in the manifest under \`skills\`), and you suspect a packaged skill might exist for it.

## Procedure

1. **Search the libraries.** Two registries are available:

   - **Corebrain library** (curated for the gateway):
     \`\`\`
     curl -s -H "Accept: application/vnd.github.v3+json" \\
       "https://api.github.com/repos/RedPlanetHQ/core/contents/docs/gateway-skills?ref=main"
     \`\`\`
     Response is a JSON array; each entry has \`name\`, \`download_url\`. Filter \`name.endsWith(".mdx")\` and ignore \`overview.mdx\`. The skill's **slug** is the filename without the \`.mdx\` extension — that's the value you'll pass to \`--skill\` in step 4.

   - **skills.sh** (the open Vercel skills ecosystem; anything here can be installed via its git URL):
     \`\`\`
     curl -s "https://skills.sh/api/v1/skills/search?q=<keywords>"
     \`\`\`

2. **Pick the closest match.** For each candidate, read the frontmatter \`title\`/\`name\` + \`description\` and pick the one whose description matches the user's intent best. For skills.sh entries the \`installUrl\` field is the git URL to use in step 4. If the API response shape is different from what's described here (fields renamed or moved), show the raw JSON to the user and ask which entry to install — don't guess at field names.

3. **Confirm with the user.** Show your top pick (title + one-line description + source) and ask whether to install it. Don't install without confirmation.

4. **Install it.** On confirmation, run:

   \`\`\`
   corebrain skills install <git-url>
   \`\`\`

   For corebrain library entries the git URL is \`https://github.com/RedPlanetHQ/core\` with \`--skill <slug>\`. For skills.sh entries use the \`installUrl\` from the API response.

   Re-poll the manifest after install to confirm the new skill is listed.

5. **Use the new skill.** Once installed, the new skill's \`name\` and \`description\` appear in the gateway's AVAILABLE SKILLS block automatically. Call \`load_skill\` with the skill \`name\` to fetch its \`SKILL.md\` body, then follow it.

## Notes

- If no candidate fits, tell the user plainly — don't pick something marginal just to have an answer.
- Don't install more than one skill per request unless the user explicitly asks for more.
- \`load_skill\` is the only way to reach files under \`~/.corebrain/skills/\` — \`files_read\` is scoped to registered folders and won't reach the skills directory.
`;

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
	{name: 'find-skills', skillMd: FIND_SKILLS},
];

export function getBuiltin(name: string): BuiltinSkill | undefined {
	return BUILTIN_SKILLS.find((b) => b.name === name);
}
