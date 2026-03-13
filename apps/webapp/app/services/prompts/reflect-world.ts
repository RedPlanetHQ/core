/**
 * Reflect World Prompt
 *
 * A quality filter pass that runs AFTER extract-world and BEFORE classify-world.
 * Removes session-specific noise — session actions, transient output, one-time
 * instructions — that slipped through extraction.
 *
 * Only filters graph_facts. Entities that are no longer referenced in the
 * filtered facts are naturally excluded when building graph triples.
 */

import { type ModelMessage } from "ai";
import z from "zod";

const ReflectedGraphFactSchema = z.object({
  source: z.string().describe("Subject entity name"),
  predicate: z.string().describe("Relationship type"),
  target: z.string().describe("Object entity name or literal value"),
  fact: z.string().describe("Natural language representation of the fact"),
  event_date: z.string().nullable().describe("ISO date for events, null otherwise"),
});

export const ReflectWorldSchema = z.object({
  graph_facts: z
    .array(ReflectedGraphFactSchema)
    .describe("Filtered graph facts — only durable, session-independent world facts"),
});

export type ReflectWorldResult = z.infer<typeof ReflectWorldSchema>;

export const reflectWorldPrompt = (
  graph_facts: Array<{
    source: string;
    predicate: string;
    target: string;
    fact: string;
    event_date: string | null;
  }>,
): ModelMessage[] => {
  const sysPrompt = `You are a quality filter for a user's digital knowledge graph.

You receive candidate graph facts extracted from a conversation. Your job: REMOVE facts that are session-specific noise. Keep only facts that represent lasting, searchable knowledge about the user's world.

## REMOVE — these do not belong in a knowledge graph

**Session actions and process steps:**
- "User asked assistant to find flights" (the session process)
- "User directed attention to file X for implementation" (session navigation)
- "User confirmed yes" / "User said go ahead" (conversational)
- What the assistant did, searched for, or reported during the session

**One-time task requests tied to in-flight work:**
- "Harshith wants a single git commit containing the current changes"
- "Harshith suggested adding a timestamp-based filter for this task"
- Any request phrased as what the user "wanted", "asked for", or "suggested" for current work

**Transient session output:**
- "5 unread emails found", "3 available flights returned", "2 reminders triggered"
- Session status reports and counts from this conversation

**Implementation details:**
- File paths, branch names, function names, PR numbers, commit messages
- Specific code implementation decisions for a single task
- API parameters, form field names, configuration values for one task

**Anything that only makes sense in today's context:**
- Facts referencing a specific in-flight artifact (a file being edited, a branch being worked on)
- Instructions or observations that are meaningless without knowing what this session was about

## KEEP — these belong in a knowledge graph

- **Relationships**: "Nina is the user's real estate agent" / "Leo leads the mobile team"
- **Identity**: "User is CTO at CORE" / "User lives in Bangalore"
- **Events** (with date): "Had annual checkup with Dr. Patel" / "Signed the lease on March 5"
- **Decisions**: "Chose PostgreSQL over MySQL" / "Decided to bring in a contractor for frontend"
- **Knowledge**: "CORE uses TypeScript and Remix" / "Apartment is a 3BHK in Koramangala"
- **Outcomes**: "Air India flight booked to Mumbai on March 20" (not the search process)
- **Problems**: "Stripe API keeps timing out, blocking payments integration"

## THE TEST

Ask: "Would this fact be meaningful and searchable to an agent next week, completely independent of today's session?"

- "Harshith wants a single git commit for current changes" → tied to today's session → **REMOVE**
- "Harshith directed attention to file gmail/src/mcp/index" → session navigation → **REMOVE**
- "Harshith suggested adding timestamp-based filter" → one-time in-session request → **REMOVE**
- "Air India flight booked to Mumbai on March 20" → lasting outcome → **KEEP**
- "Leo leads the mobile team" → lasting relationship → **KEEP**

Return only the facts that pass the test. When uncertain, REMOVE.`;

  const factsFormatted = graph_facts
    .map(
      (f, i) =>
        `${i + 1}. [${f.source} → ${f.predicate} → ${f.target}] "${f.fact}"${f.event_date ? ` (${f.event_date})` : ""}`,
    )
    .join("\n");

  const userPrompt = `Review these candidate graph facts and remove any that are session-specific noise.

<candidate_facts>
${factsFormatted}
</candidate_facts>

Return only the facts that represent durable, lasting knowledge about the user's world.`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
