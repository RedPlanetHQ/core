/**
 * Extract World Prompt
 *
 * Extracts the user's world as graph facts (SPO triples) and entities.
 * Focused on: identity, events, relationships, decisions, knowledge, problems.
 *
 * This prompt does NOT classify aspects — that happens in classify-world.
 * This prompt does NOT extract voice facts — that happens in extract-voice.
 */

import { type ModelMessage } from "ai";
import z from "zod";
import { EntityTypes } from "@core/types";

/**
 * A graph fact — user's world, stored as an atomic SPO triple
 */
const GraphFactSchema = z.object({
  source: z
    .string()
    .describe("Subject entity name"),
  predicate: z
    .string()
    .describe("Relationship type"),
  target: z
    .string()
    .describe("Object entity name or literal value"),
  fact: z
    .string()
    .describe("Concise natural language representation (max 15 words)"),
  event_date: z
    .string()
    .nullable()
    .describe("ISO date for events, null otherwise"),
});

/**
 * Entity extracted from the episode
 */
const EntitySchema = z.object({
  name: z
    .string()
    .describe("Entity name — clean, without articles or qualifiers"),
  type: z
    .enum(EntityTypes)
    .optional()
    .describe("Entity type classification"),
  attributes: z
    .record(z.any(), z.any())
    .optional()
    .describe("Lookup data: email, phone, company, role, etc."),
});

export const ExtractWorldSchema = z.object({
  entities: z.array(EntitySchema).describe("All extracted entities"),
  graph_facts: z
    .array(GraphFactSchema)
    .describe("User's world — identity, events, relationships, decisions, knowledge"),
});

export type ExtractWorldResult = z.infer<typeof ExtractWorldSchema>;

export const extractWorldPrompt = (
  context: Record<string, any>,
): ModelMessage[] => {
  const sysPrompt = `You are building a user's digital brain — a persistent memory that helps them recall information weeks, months, or years from now.

Your job: Read a normalized episode and extract WORLD FACTS — what exists in the user's world — as graph facts (SPO triples).

World facts are: who the user is, what happened, who they know, what they decided, how their projects/systems work, what problems they face.

NOT world facts: how the user operates (rules, preferences, habits, beliefs, goals) — those are voice facts, extracted separately.

## THE BRAIN TREE

\`\`\`
User (root)
    ├── Identity — who they are (role, stats, location, health)
    ├── Relationships — people and companies connected to the user
    ├── Events — what happened (meetings, milestones, incidents)
    ├── Decisions — choices the user made
    └── Things they own or work on — open-ended, any topic
          ├── capabilities, features, integrations
          ├── tech stack, architecture, infrastructure
          ├── plans, targets, timelines
          ├── problems, blockers, issues
          └── ... any fact about something the user owns
\`\`\`

Every fact must connect to the user through this tree. If a fact has no path back to the user — skip it.

## THINK before extracting

Before producing output, reason through the episode:

**1. WHO is in this episode?** For each person/company, determine TWO things:
- Their role in the USER's life (the relationship) — customer, teammate, investor, friend
- Their own identity — job title, company, background

These are different. A person's own identity is NOT their relationship to the user.
- Facts about the user → graph facts
- Relationship to user → graph fact: User → role → Person
- Other person's own details (title, company, email, phone, location) → entity attributes

Ask: "If the user met this person on the street, how would they introduce them?"
- "This is Leo, he's on my team" → teammate
- "This is Nina, she invested in our seed round" → investor
- "This is Arjun, he's been using our product for his startup" → product user/customer

Strip away the channel (email, WhatsApp, Slack) and the action (asked, requested, replied). What remains is the relationship.

**2. TRACE the tree.** Map every person, topic, and fact to the user:
\`\`\`
User
├── identity → [role, stats, location, health metrics]
├── [role] → [person/company] → their details, asks, actions
├── [project/product] → tech, features, capabilities
├── [plan/goal] → targets, timeline, status
└── [any topic the user owns] → relevant facts
\`\`\`
Every edge and leaf in this tree is a graph fact. Don't stop at the edges — follow each branch to its leaves. A project has features. A person has asks. A plan has targets. Extract them all.

## WHAT TO EXTRACT

For each fact, check:
- **Substance**: Is this INSIDE the episode (what was discussed) or ABOUT the episode (that they talked, what channel)? Only extract substance.
- **Ownership**: Does the user own this? Their identity, projects, people, decisions → yes. Other products, market trends, generic knowledge → no.
- **Lasting**: Will this matter in a week? Identity, relationships, project facts → yes. Session actions ("requested", "updated", "fixed"), one-time asks → no.

**Speaker attribution applies to ACTIONS and OPINIONS — not to facts about the user's world:**
- User said/decided/confirmed → EXTRACT
- Assistant created something that became user's state → extract the OUTCOME, not the action
- Assistant advised/opined → SKIP (unless user confirmed)
- Facts about the user's world REVEALED during the episode → EXTRACT regardless of who mentioned them. A person's role, a product capability, a project fact — these exist in the user's world whether the user or assistant stated them.

**Relationships:** When a person appears, their role is often the most important fact. Extract it as: User → role → Person | "Person is a [role]."

**Implicit facts:** Not everything is stated directly.
- "signed the contract last week" → a deal was closed (event + relationship)
- "benchmark showed 200ms p99 latency" → performance metric measured
- "migrated from Heroku last quarter" → migration event with timing

**Empty extraction is valid.** Some episodes have zero lasting world facts. Return empty arrays.

## GRAPH FACT WRITING

Extract at three subject levels:

| Level | Subject | Example |
|-------|---------|---------|
| User | User's name | Manoj → is → CTO at CORE |
| User→Topic | User's name | Manoj → leads → Database Migration |
| Topic | Topic entity | Migration Plan → targets → zero downtime |

Keep facts SHORT: max 15 words, one clear sentence.
- ✗ "John prefers to have meetings in morning because productivity is higher"
- ✓ "John prefers morning meetings."

Graph structure provides context — don't repeat it in fact strings.

**event_date**: Only for events with specific timing. Leave null otherwise.

**One fact per thing**: A single thing (meeting, task, event) = ONE fact that captures what it is and why it matters. Don't decompose into separate facts for each attribute (time, duration, participants, location). Put details in the fact string or entity attributes — not as separate graph facts.

## ENTITY EXTRACTION

Extract named entities that appear in graph facts.

**Test**: "Would I search for this entity to find user-specific information?"

**Naming**: Short (max 2-3 words), reusable. Person → name only ("Sarah" not "Sarah contact").

**Attributes** (lookup data): email, phone, company, role, location, github_url, task_id, etc.
- User's identity → graph facts (for history tracking)
- Other people's identity → entity attributes (for lookup)

<entity_types>
${EntityTypes.filter((t) => t !== "Predicate")
  .map((t) => `- ${t}`)
  .join("\n")}

Key distinctions:
- Technology vs Product: devs build with it → Technology. Users do work with it → Product.
- Don't overthink typing — relationships matter more. When ambiguous, use closest fit.
</entity_types>

## EXAMPLES

### Example 1: Identity and project facts
Episode: "Current body fat is 31%. CORE uses TypeScript, Remix for frontend, Prisma ORM. Decided to use PostgreSQL."

graph_facts:
- Manoj → has → 31% body fat | "Manoj has 31% body fat." | null
- CORE → uses → TypeScript | "CORE uses TypeScript." | null
- CORE → uses → Remix | "CORE uses Remix for frontend." | null
- CORE → uses → Prisma | "CORE uses Prisma for ORM." | null
- CORE → decided → PostgreSQL | "CORE decided to use PostgreSQL." | null

entities: Manoj (Person), CORE (Project), TypeScript (Technology), Remix (Technology), Prisma (Technology), PostgreSQL (Technology)

### Example 2: Implicit relationship and noise
Episode: "User complained that the report formatting looks off — headings should always be bold, not italic. Assistant pulled up the analytics dashboard and found that trial user Marco from PixelForge has been stuck on the onboarding step for 3 days. Assistant suggested reaching out. User said yes, also mentioned PixelForge is Series A funded and they're evaluating three vendors. Assistant drafted an outreach email and asked if the tone is right."

graph_facts:
- User → has_trial_user → Marco | "Marco is a trial user." | null
- Marco → stuck_on → Onboarding | "Marco stuck on onboarding step for 3 days." | null
- PixelForge → raised → Series A | "PixelForge is Series A funded." | null
- PixelForge → evaluating → Vendors | "PixelForge is evaluating three vendors." | null
- User → will_reach_out_to → Marco | "User decided to reach out to Marco." | null

entities: Marco (Person, attributes: {company: "PixelForge"}), PixelForge (Organization)

Why:
- Marco's relationship inferred from context → trial user (never explicitly stated)
- "Headings should always be bold" = voice fact → extracted separately, NOT here
- "Assistant pulled up dashboard" / "drafted email" → session actions → SKIP
- "Assistant suggested reaching out" → advice → SKIP (but user confirmed → extract the decision)

### Example 3: Task execution (mostly skip)
Episode: "User asked assistant to fix waitlist email drafts to match the WhatsApp Waitlist Skill documentation Step 2 template. Assistant updated 17 waitlist-related email drafts with the correct subject and body template. No emails were sent."

graph_facts:
- Manoj → drafted → Waitlist Emails | "17 waitlist early access emails drafted, not sent." | 2026-03-09

entities: Waitlist Emails (Concept)

Why: Request + assistant action = session noise. Only the lasting OUTCOME matters: emails exist in draft state.

## OUTPUT
Return entities and graph_facts.`;

  const userIdentitySection = context.userName
    ? `<user_identity>
The user is: ${context.userName}
"${context.userName}" IS the user. Extract facts about ${context.userName} and their projects/work.
</user_identity>

`
    : "";

  const userPrompt = `${userIdentitySection}<episode>
${context.episodeContent}
</episode>

Extract graph facts (user's world) from this episode.`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
