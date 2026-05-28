/**
 * Built-in skills.
 *
 * Skills that ship with the agent itself — never seeded to the database,
 * never shown in the user's skills UI, but always available in every
 * workspace's <skills> block so the agent can discover and load them via
 * get_skill the same way as user-installed skills.
 *
 * IDs are synthetic and namespaced with the `builtin:` prefix so that:
 *   - get_skill can route lookups to this module instead of the DB
 *   - the IDs never collide with DB-backed skill UUIDs
 *
 * Add a new entry here when there's a behavior we want the agent to
 * consistently know about across all workspaces without users having to
 * install or manage it.
 */

export interface BuiltinSkillDef {
  /** Stable synthetic ID, must start with "builtin:". */
  id: string;
  title: string;
  shortDescription: string;
  content: string;
}

const BUILTIN_ID_PREFIX = "builtin:";

export const BUILTIN_SKILLS: BuiltinSkillDef[] = [
  {
    id: "builtin:decompose-task",
    title: "Decompose Task",
    shortDescription:
      "Use when a task looks big — decide whether to split into subtasks and how.",
    content: `# Decompose Task

You're inside an execute mind on a task that looks big. This skill helps you decide whether to split it into subtasks and, if so, how.

## Default answer: don't split

Most tasks are one unit of work even if they involve several steps. Linear steps inside one task are fine — write them in the description, execute them in order, mark Review. Don't reach for decomposition unless one of the SPLIT triggers below clearly fires.

## SPLIT when (at least one is true)

- **Multiple independent deliverables** that don't share runtime state — each could be handed to a different person without coordination. Examples: "set up OAuth provider + build login UI + add session middleware", "draft the investor email + the customer email + the team announcement".
- **Irreversibly bulk action** that benefits from per-chunk review boundaries: mass deletions, mass sends, schema migrations, refactors touching >5 files.
- **User explicitly said** "plan this", "decompose this", "split this up", "think through this".

## DON'T SPLIT when

- The work is a single artifact (one summary, one email, one investigation, one PR).
- The "steps" are sequential and tightly coupled (set up DB → seed it → smoke test). That's one task — write the steps in the description.
- You're tempted to split into "Planning" / "Execution" phases. Phases are NOT decomposition. Skip.
- One chunk would just be "wait for user reply". Use Waiting status on the current task instead — Waiting is for blockers, subtasks are for divide-and-conquer.

## HOW to split (when splitting)

1. **Each subtask is a meaningful work chunk** — a deliverable, not a phase. Bad: "Plan", "Execute", "Verify". Good: "Set up OAuth provider", "Build login form", "Add session middleware".
2. **Subtasks must be independent.** They run in parallel — no shared mid-execution state, no ordering assumptions. If A depends on B's output, fold them into one task instead.
3. **Call create_task with parentTaskId set and no status override.** Subtasks default to Ready and start their own execution cycle on the 2-minute buffer. Each runs through its own SKILL CHECK and execute mind.
4. **Write the breakdown into the parent description** via update_task with a <plan> section listing the subtask titles so the user can see the split.
5. **Send a heads-up message.** "Splitting this into A, B, C — each starts in 2 min. Stop me if wrong." Don't move the parent to Waiting — the buffer already gives the user a veto window. Parent stays Working until all subtasks complete; the system auto-marks it Done.

## Max depth

Two levels: epic → task → subtask. A subtask cannot decompose further. If a subtask feels like it needs splitting, the parent was scoped wrong — go back, redo the parent split.

## After deciding NOT to split

Just execute the task. Don't write an "I considered splitting but decided not to" message — silence is the default.`,
  },
];

/**
 * Look up a built-in skill by its synthetic ID. Returns undefined if no
 * built-in skill has that ID (caller should fall through to the DB lookup).
 */
export function getBuiltinSkill(id: string): BuiltinSkillDef | undefined {
  return BUILTIN_SKILLS.find((s) => s.id === id);
}

/**
 * Cheap discriminator: any ID with the `builtin:` prefix is a built-in skill
 * and must be resolved via this module, not Prisma.
 */
export function isBuiltinSkillId(id: string): boolean {
  return id.startsWith(BUILTIN_ID_PREFIX);
}
