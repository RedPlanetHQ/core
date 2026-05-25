/**
 * Default skill definitions — seeded on workspace creation and migration.
 */

export interface DefaultSkillDef {
  title: string;
  skillType: string;
  shortDescription: string;
  content: string;
  /** Session ID prefix for upsert — workspaceId will be appended as `${sessionId}-${workspaceId}` */
  sessionIdPrefix?: string;
}

export const DEFAULT_SKILL_DEFINITIONS: DefaultSkillDef[] = [
  {
    title: "Persona",
    skillType: "persona",
    sessionIdPrefix: "persona-v2",
    shortDescription:
      "Use when composing messages, making decisions, or responding on the user's behalf.",
    content: `
## IDENTITY

_Your name, role, location, affiliations, and anything else that defines who you are. The butler uses this when introducing or representing you._

## PREFERENCES

_How you like things done — communication style, tools, formatting, defaults. The butler uses this when making decisions on your behalf._
_Example: "Direct and brief. No fluff. Skip 'I hope this email finds you well.' Sign off with just my first name."_

## DIRECTIVES

_Standing rules and active decisions — always do X, never do Y, use Z for W. The butler treats these as non-negotiable._`,
  },
  {
    title: "Watch Rules",
    skillType: "watch-rules",
    shortDescription:
      "Use when an inbound event arrives to decide what to handle silently vs what to surface.",
    content: `## Surface Immediately

- Direct mentions or assignments from my manager or key stakeholders
- Anything marked urgent or with a hard deadline today
- PR review requests where I'm the assigned reviewer
- Calendar alerts for meetings starting within 30 minutes
- Replies to emails I sent that have been waiting more than 2 days

## Handle Silently

- All newsletters, promotional emails, automated notifications
- Build/CI status unless it's a failure on main or production
- GitHub notifications where I'm not directly mentioned (CC'd on issues, reactions, etc.)
- Slack messages in channels I'm not actively part of
- Any activity on issues or PRs I didn't open or comment on

## Default Rule

When in doubt: if I'm directly involved (assigned, mentioned, replied-to) → surface it.
If it's ambient noise from a system or group I'm passively in → handle silently.

## Task suggestions — where they go in the scratchpad

Whenever an inbound event (memory_ingest, integration webhook, channel message) contains something I might want to act on, you must add it to TODAY's scratchpad as a task suggestion. Suggestions are PROSE BULLETS, not real tasks — I convert them manually if I want.

**Location.** All task suggestions live inside today's brief block — the \`<h3>Brief — {weekday, month day}</h3>\` heading that the morning brief task creates at 9am.

- Place each suggestion as an \`<li>\` under an \`<h4>Live finds</h4>\` sub-heading INSIDE the brief block.
- If the brief block doesn't exist yet today (e.g. the surfacing fires before 9am or the morning task hasn't run), call \`update_scratchpad\` with the heading AND the Live finds sub-section in one go:

  \`\`\`html
  <h3>Brief — {weekday, month day}</h3>
  <h4>Live finds</h4>
  <ul>
    <li><em>HH:MM</em> — {short verb-first action}</li>
  </ul>
  \`\`\`

- If the brief block already exists but has no Live finds section, append the section + first item.
- If Live finds already exists, append the \`<li>\` to the existing \`<ul>\`.
- The morning task owns "Carried over", "Suggested today", and "Heads up". Never write into those — they're a snapshot of what the system saw at 9am. "Live finds" is the running additions throughout the day.

**Format.** One line per suggestion. Verb-first. ~8 words.

- ✅ \`<li><em>10:23</em> — Reply to Sarah re: Q3 deck</li>\`
- ✅ \`<li><em>14:07</em> — Review PR #142</li>\`
- ❌ Multi-line entries, prose paragraphs, or anything explaining where the suggestion came from.

**When to add a suggestion:**
- The item is specific (has a name, an artifact, a deadline).
- It's actionable in the next ~24h.
- Surfacing decision (shouldMessage true/false) is INDEPENDENT — a suggestion can be added to the scratchpad even when you decide NOT to ping the channel.

**When NOT to add:**
- Aspirational or vague ("I should learn Rust someday").
- Already added today — check the scratchpad first if unsure.
- Non-actionable info (deploy paused, meeting moved without your involvement). Those don't go in Live finds.
- Silent (non-surfaced) ambient noise — newsletters, automated notifications, status updates.

**Never write task suggestions outside the brief block.** Anything I wrote myself on the page is sacred.

## Memory ingest (trigger.type = memory_ingest)

A Mac session compact just landed — trigger payload contains the FULL summary text. Scan the summary (especially its \`Next\` section) for task suggestions.

- For each task suggestion you identify, follow the "Task suggestions" rule above and append it to today's brief block under Live finds.
- Channel ping (shouldMessage=true) only if the suggestion is genuinely time-sensitive (deadline today, meeting in <2h, blocker). Otherwise: write to scratchpad, stay silent on channels.
- For \`kind="updated"\` compacts: only emit a NEW suggestion if it wasn't already in the prior compact. Pure refinements/re-statements → silent + no scratchpad write.`,
  },
  {
    title: "Morning Brief",
    skillType: "morning-brief",
    shortDescription:
      "Daily 9am pass — scans connected integrations + recent memory, writes a structured brief to today's scratchpad.",
    content: `# Morning Brief

Runs daily (default 9am user-local). Goal: when the user opens their scratchpad in the morning, the top of the page shows what's already on their plate plus anything the system noticed in the last 24h.

## Steps

1. **Read today's scratchpad first.** Call \`get_scratchpad\` with no date (defaults to today). If a "Brief —" heading already exists for today, STOP — the brief has already been written. Do not write a duplicate.

2. **Gather data.** In parallel where possible:
   - **Carried over**: still-Todo tasks (\`list_tasks status=Todo\`) — include open count days from createdAt.
   - **Suggested today**: from connected integrations (use \`take_action\` or relevant integration tools to peek at the last 24h — unread important emails, today's calendar, PRs awaiting your review, @mentions you haven't responded to). Also pull recent Task-aspect memories with \`search_memory\` filtered to last 24h if available.
   - **Heads up**: non-actionable but worth knowing — meeting moves, deploys, ambient changes from integrations.

3. **Compose the brief** as plain HTML using EXACTLY this structure. Omit any section that has zero items. Cap each section at 5 entries.

\`\`\`html
<h3>Brief — {Weekday, Month Day}</h3>

<h4>Carried over</h4>
<ul>
  <li>{task title} <em>(open {N} days)</em></li>
</ul>

<h4>Suggested today</h4>
<ul>
  <li>{verb-first action item, ~8 words}</li>
</ul>

<h4>Heads up</h4>
<ul>
  <li>{short factual note}</li>
</ul>
\`\`\`

4. **Write to scratchpad.** Call \`update_scratchpad\` with the HTML above, \`mode="append"\`, \`date\` omitted. This adds the brief to today's page without disturbing whatever the user has already written.

5. **No channel notification.** Do NOT call \`send_message\`. The brief is meant to be discovered when the user opens their scratchpad — pinging them defeats the purpose.

## Rules

- **Plain bullets, not \`<taskItem>\` nodes.** The user converts items to real tasks manually if they want. Suggestions should not auto-create tasks.
- **Dedupe.** Items in "Carried over" must not also appear in "Suggested today".
- **Be conservative.** Better to surface 3 high-quality items than 5 marginal ones. An empty section is fine.
- **If everything is empty**, still write the minimal heading (\`<h3>Brief — ...</h3>\`) so the user can see the brief ran. No body required.
- **Never replace.** Always \`mode="append"\`. The user's own scratchpad writing is sacred.

## When to skip entirely
- If today's scratchpad already has a "Brief —" heading (step 1).
- If the user has explicitly turned the morning brief task off (this skill won't be invoked in that case — handled by the scheduled task being inactive).`,
  },
];
