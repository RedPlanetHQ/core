/**
 * Default skill definitions — seeded on workspace creation and migration.
 */

export interface DefaultSkillDef {
  title: string;
  skillType: string;
  shortDescription: string;
  content: string;
}

export const DEFAULT_SKILL_DEFINITIONS: DefaultSkillDef[] = [
  {
    title: "Persona",
    skillType: "persona",
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
    content: `## How to read my scratchpad

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

**Grouping:**
When I write a header with a list underneath it, treat the whole section as one item. Comment on the section header, not each bullet point.

**For open-ended tasks:**
When I write something like "create a Show HN post" or "think about our pricing", don't dive into execution. Instead: gather what you know from memory, pull relevant reference material, then ask me 2-3 initiating questions so we can get to a first concrete output together.

**My preferences:**
- Keep comments short and to the point
- Ask before doing anything irreversible`,
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
