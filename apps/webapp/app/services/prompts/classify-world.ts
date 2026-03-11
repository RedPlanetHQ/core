/**
 * Classify World (Graph) Aspects Prompt
 *
 * Step 3b: Classifies graph facts into specific aspect types.
 * Input: graph_facts from comprehend-evaluate
 * Output: classified graph aspects (Identity, Event, Relationship, Decision, Knowledge, Task)
 */

import { type ModelMessage } from "ai";
import z from "zod";
import { GRAPH_ASPECTS } from "@core/types";

export const ClassifiedGraphFactSchema = z.object({
  source: z.string().describe("Subject entity name"),
  predicate: z.string().describe("Relationship type"),
  target: z.string().describe("Object entity name or literal value"),
  fact: z.string().describe("Natural language fact (preserved as-is)"),
  aspect: z.enum(GRAPH_ASPECTS).nullable().describe("Graph aspect or null for pure topic facts"),
  event_date: z.string().nullable().describe("ISO date for events, null otherwise"),
});

export const ClassifyWorldSchema = z.object({
  facts: z.array(ClassifiedGraphFactSchema).describe("Classified graph facts"),
});

export type ClassifyWorldResult = z.infer<typeof ClassifyWorldSchema>;

export const classifyWorldPrompt = (
  graphFacts: Array<{
    source: string;
    predicate: string;
    target: string;
    fact: string;
    event_date: string | null;
  }>,
  userName?: string,
): ModelMessage[] => {
  const sysPrompt = `You classify graph facts into one of 7 aspect types (or null).

Read the fact. Understand what it means. Pick the aspect that best describes what the fact IS ABOUT.

## Aspects

**Identity** — Who the user IS. Slow-changing personal facts that define them: role, location, measurements, stats, affiliations, what they work on.
- "User is CTO at CORE" → Identity
- "User weighs 98.8 kg" → Identity
- "User works on RedPlanetHQ/core" → Identity
NOT: behavioral patterns the user is trying to change → Problem.

**Event** — Something the user personally DID or EXPERIENCED at a specific time. The user must be a direct participant. Must have event_date.
- "Had demo call with Acme on Tuesday" → Event
- "Signed the contract last week" → Event
NOT: activity on user's project by others (team commits, PRs by teammates) — user didn't participate → Knowledge or null.

**Relationship** — The BOND between the user and another person/company. Only the connection itself — not what they do, want, or build.
- "Harshith is a co-founder" → Relationship
- "Frank is a product user" → Relationship
- "NovaTech is a vendor" → Relationship
NOT: what a connected person wants, does, or builds → null.

**Decision** — An explicit CHOICE the user made between alternatives. The user weighed options and picked one.
- "Chose PostgreSQL over MySQL" → Decision
NOT: plans or intentions without alternatives considered → Knowledge.

**Knowledge** — Facts about things the user OWNS or BUILDS. Their projects, systems, products, infrastructure — how things work in their world.
- "CORE uses TypeScript" → Knowledge
- "Search pipeline has 5 stages" → Knowledge
NOT: facts about someone else's product/company → null.

**Problem** — An ONGOING issue that keeps affecting the user. Persistent blockers, recurring failures, behavioral struggles.
- "CRM integration drops connection every few hours" → Problem
- "Struggles with executing the diet plan" → Problem
NOT: transient/one-time errors → null.

**Task** — A one-time commitment or action item the user needs to do. Follow-ups, promises, pending actions with a clear completion state.
- "Share the updated pricing doc with the sales team" → Task
- "Review and approve the design mockups before launch" → Task
NOT: sustained objectives the user works toward over time → Goal. NOT: standing rules for systems → Directive.

**null** — Facts that don't fit any aspect. Third-party entity facts, other people's actions/opinions, structural facts.

## Rules
- Each fact gets exactly ONE aspect (or null)
- Do NOT modify fact text, source, predicate, or target
- Preserve event_date from input
- Classify based on WHAT THE FACT MEANS, not keywords in the text
- If a fact about the user doesn't clearly fit, use Knowledge as default${userName ? `\n- "${userName}" IS the user` : ""}`;

  const factsFormatted = graphFacts
    .map(
      (f, i) =>
        `${i + 1}. ${f.source} → ${f.predicate} → ${f.target} | "${f.fact}"${f.event_date ? ` | date: ${f.event_date}` : ""}`,
    )
    .join("\n");

  const userPrompt = `Classify each graph fact:

${factsFormatted}`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
