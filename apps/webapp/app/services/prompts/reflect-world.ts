/**
 * Reflect World Prompt
 *
 * A quality filter pass that runs AFTER extract-world and BEFORE classify-world.
 * Removes session-specific noise — session actions, transient output, one-time
 * instructions — that slipped through extraction.
 *
 * Receives the original episode content so it can resolve ambiguous facts
 * (e.g., an outcome vs. a session action, a decision vs. a one-time request).
 * Only filters graph_facts. Entities no longer referenced are excluded naturally.
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
  episodeContent: string,
): ModelMessage[] => {
  const sysPrompt = `You are a quality filter for a user's digital knowledge graph.

You receive candidate graph facts extracted from a conversation, along with the original episode so you can verify each fact in context. Your job: REMOVE facts that are session-specific noise. Keep only facts that represent lasting, searchable knowledge about the user's world.

Use the episode to resolve ambiguity — check whether a fact describes a real outcome/decision/relationship or just what happened during this session.

## REMOVE — these do not belong in a knowledge graph

**Session actions and process steps:**
- "User asked assistant to find flights" (the session process)
- "User checked the warranty document in the kitchen drawer" (session navigation)
- "User confirmed yes" / "User said go ahead" (conversational)
- What the assistant did, searched for, or reported during the session

**One-time task requests tied to in-flight work:**
- "User wants the guest bedroom added to this weekend's cleaning schedule"
- "User asked to include the 10% discount on this invoice"
- Any request phrased as what the user "wanted", "asked for", or "suggested" for current work

**Transient session output:**
- "5 unread emails found", "3 available flights returned", "2 reminders triggered"
- Session status reports and counts from this conversation

**Implementation details:**
- Specific instructions for completing one task (recipe steps, form fields, template choices)
- Details about HOW something was done, not WHAT the outcome was
- Configuration values, account numbers, or reference IDs for one-time use

**Anything that only makes sense in today's context:**
- Facts referencing a specific in-flight artifact (a draft being reviewed, a reservation being made)
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

- "User wants the guest bedroom added to this weekend's cleaning" → tied to today's session → **REMOVE**
- "User checked the warranty document in the kitchen drawer" → session navigation → **REMOVE**
- "User asked to include the discount on this invoice" → one-time in-session request → **REMOVE**
- "Air India flight booked to Mumbai on March 20" → lasting outcome → **KEEP**
- "Leo leads the mobile team" → lasting relationship → **KEEP**

Return only the facts that pass the test. When uncertain, check the episode — if the original text confirms a real outcome, relationship, or decision, KEEP. If it's clearly a session action or one-time request, REMOVE.`;

  const factsFormatted = graph_facts
    .map(
      (f, i) =>
        `${i + 1}. [${f.source} → ${f.predicate} → ${f.target}] "${f.fact}"${f.event_date ? ` (${f.event_date})` : ""}`,
    )
    .join("\n");

  const userPrompt = `Review these candidate graph facts using the original episode as context.

<episode>
${episodeContent}
</episode>

<candidate_facts>
${factsFormatted}
</candidate_facts>

Return only the facts that represent durable, lasting knowledge about the user's world.`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
