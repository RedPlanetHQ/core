---
name: find-skills
description: Find and install gateway skills from the corebrain library when none of the currently installed skills fit the task.
allowed-tools: [exec_command, files_read]
---

# find-skills

Use this when the user's request doesn't clearly match any of the currently installed skills, and you suspect a packaged skill might exist for it.

## Procedure

1. **List the library.** The corebrain library lives at
   `https://api.github.com/repos/RedPlanetHQ/core/contents/docs/gateway-skills?ref=main`.
   Fetch it via `exec_command`:

   ```
   curl -s -H "Accept: application/vnd.github.v3+json" \
     "https://api.github.com/repos/RedPlanetHQ/core/contents/docs/gateway-skills?ref=main"
   ```

   The response is a JSON array; each entry has `name`, `download_url`. Filter
   `name.endsWith(".mdx")` and ignore `overview.mdx`.

2. **Pick the closest match.** For each candidate, fetch the `download_url`
   and read the YAML frontmatter `title` + `description`. Pick the one whose
   description matches the user's intent best.

3. **Confirm with the user.** Show your top pick to the user (title + one-line
   description) and ask whether to install it. Don't install without confirmation.

4. **Install it.** On confirmation, the library entry's slug is the skill's
   git URL slug. Run:

   ```
   corebrain skills install <git-url>
   ```

   The exact git URL is in the candidate's `frontmatter.repo` (if present) or
   you can ask the user to paste it. Re-poll the manifest after install to
   confirm the new skill is listed.

5. **Use the new skill.** Once installed, the new skill's `name` and
   `description` appear in your next system prompt. Re-read the user's
   intent and follow the new skill's `SKILL.md`.

## Notes

- If no candidate fits, tell the user plainly — don't pick something marginal
  just to have an answer.
- Don't install more than one skill per request unless the user explicitly
  asks for more.
