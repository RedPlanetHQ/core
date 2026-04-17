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
