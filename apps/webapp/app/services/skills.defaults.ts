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
If it's ambient noise from a system or group I'm passively in → handle silently.`,
  },
];
