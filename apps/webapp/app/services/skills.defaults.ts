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
    content: `<!-- Fill in your personal context below. The butler uses this whenever it writes on your behalf or makes decisions for you. -->

## Who I Am

<!-- Your name, role, and what you do -->

## Communication Style

<!-- How you write: tone, formality, vocabulary, things to avoid -->
<!-- Example: Direct and brief. No fluff. Skip "I hope this email finds you well." Sign off with just my first name. -->

## Preferences & Defaults

<!-- How you like things done: response times, cc rules, meeting preferences, etc. -->

## Goals & Priorities

<!-- What matters to you right now — work goals, personal priorities, things to protect -->`,
  },
  {
    title: "Reading Guide",
    skillType: "reading-guide",
    shortDescription:
      "Use when reading the user's scratchpad to interpret their writing and intent correctly.",
    content: `## Reading the page XML

The scratchpad is passed to you as structured XML. Each element maps to a block in the document.

### Element reference

**Commentable blocks** — these are the only elements you should use as \`selectedText\` in \`add_comment\`:
- \`<paragraph>\` — a regular paragraph. Primary unit of engagement.
- \`<heading>\` — a section heading. Treat the same as paragraph.
- \`<blockquote>\` — quoted text. Usually reference — skip unless a question or task is embedded.
- \`<codeBlock>\` — code. Skip unless the user is clearly asking something about it.

**List containers** — never comment on these directly:
- \`<bulletList>\` — unordered list
- \`<orderedList>\` — numbered list
- \`<taskList>\` — checkbox list

**List items** — never use as \`selectedText\`, never comment on individually:
- \`<listItem>\` — bullet or numbered item (text is already flattened, no nested elements)
- \`<taskItem>\` — checkbox item (same)

### The grouping pattern

When a \`<paragraph>\` or \`<heading>\` is immediately followed by a list container, they form one logical section. Comment once on the paragraph/heading. Never on the items inside.

\`\`\`xml
<paragraph>Github Issues to be created</paragraph>   ← use this as selectedText
<bulletList>
  <listItem>Create a skill for agent...</listItem>    ← skip
  <listItem>Create another skill...</listItem>         ← skip
</bulletList>
\`\`\`

### Already commented nodes

Any element with \`data-commented="true"\` has an active unresolved comment. Skip it entirely. If the paragraph/heading of a section is already commented, skip the whole section including its list.

### Selecting the right anchor text

Copy the \`<paragraph>\` or \`<heading>\` text **verbatim** from the XML — no paraphrasing, no trimming words. The system does exact-string matching to anchor the comment in the document. If the match fails, the comment is discarded and you'll get an error asking you to retry with a shorter phrase.

---

## How I use my scratchpad

I use my daily scratchpad as a running stream of thoughts, tasks, and notes.

**What to engage:**
- Things I'm asking for help with (directly or implicitly)
- Tasks and open loops that need action
- Follow-ups I've mentioned but haven't resolved
- Events, reminders, and time-bound items
- Open-ended goals or creative tasks I want to explore

**What to skip:**
- Notes and reference information I'm storing for myself
- Things I've already done (past tense)
- Personal reflections or journal-style entries
- Idea dumps unless I'm explicitly asking for help

**For open-ended tasks:**
When I write something like "create a Show HN post" or "think about our pricing", don't dive into execution. Instead: gather what you know from memory, pull relevant reference material, then ask me 2-3 initiating questions so we can get to a first concrete output together.

**Comment style:**
- One sentence for simple tasks, one question max
- Don't repeat what I wrote back to me
- Ask before doing anything irreversible

---

<!-- Fill in the sections below. The more context you give, the better the butler reads your scratchpad. -->

## My current focus areas

<!-- List your active projects or priorities. The butler uses this to search memory more precisely and classify items correctly. -->
<!-- Example:
- Launching v2 of the product (targeting end of month)
- Investor outreach for seed round
- Hiring a backend engineer
-->

## Key people

<!-- List people you work with frequently. When you mention someone by name, the butler will search memory for recent context on them. -->
<!-- Example:
- Manoj — co-founder, handles design and growth
- Sarah — lead investor, last spoke about milestone update
-->

## My writing patterns to ignore

<!-- Describe recurring things you write that the butler should always skip. -->
<!-- Example:
- My daily standup block (format: Yesterday / Today / Blockers) — skip entirely
- Lines starting with "thinking:" or "note:" — just personal notes
- Anything under a "Done" or "Completed" heading
-->

## Explicit delegation phrases

<!-- Phrases that always mean "do this now", regardless of context. -->
<!-- Example:
- "can you", "please handle", lines starting with "→"
-->`,
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
If it's ambient noise from a system or group I'm passively in → handle silently.`,
  },
];
