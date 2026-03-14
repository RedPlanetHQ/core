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
    .describe("Natural language sentence starting with the subject (source entity). Max 15 words."),
  event_date: z
    .string()
    .nullable()
    .describe("ISO date for events, null otherwise"),
});

/**
 * Entity extracted from the episode
 */
// Note: `type` and `attributes` use `.nullable()` (not `.optional()`) so the LLM can
// return null when values are unknown, while keeping the fields in the JSON schema's
// `required` array. OpenAI's strict mode rejects schemas where `required` doesn't
// include every property — `.optional()` removes the field from `required` and breaks it.
const EntitySchema = z.object({
  name: z
    .string()
    .describe("Entity name — clean, without articles or qualifiers"),
  type: z
    .enum(EntityTypes)
    .nullable()
    .describe("Entity type classification"),
  attributes: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .nullable()
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
  const sysPrompt = `You are building a user's digital brain. This brain is an API for agents — any agent (email drafter, meeting prep, code assistant, WhatsApp bot) queries it to understand the user's world.

Your job: Extract WORLD FACTS as graph facts (SPO triples). These are the searchable index of the user's world — who they are, who they know, what they work on, what happened, what they decided.

## FACTS ARE SEARCH HOOKS, NOT TRANSCRIPTS

The episode holds the full content. Facts exist so agents can FIND that episode later. Write facts that would match a query — not facts that replicate the transcript.

An agent searches by: **aspect** (Identity, Knowledge, Event, Decision, Relationship, Problem), **topic labels**, and **fact text** (vector + BM25). Your facts must be written so they land in the right aspect bucket and match the queries an agent would ask.

Ask: **"What query would an agent ask that should find this episode?"**
- "Who is Dr. Patel?" → needs a Relationship fact connecting Dr. Patel to the user
- "What happened at the board meeting?" → needs one Event fact as a hook
- "What's the status of the kitchen renovation?" → needs a Knowledge fact about the project

## THE OWNERSHIP TREE

\`\`\`
User (root)
    ├── Identity — who they are (role, stats, location, health)
    ├── Relationships — people connected to the user
    ├── Events — what the user did or experienced
    ├── Decisions — choices the user made
    └── Things they own or build
          ├── tech stack, architecture
          ├── features, capabilities
          ├── problems, blockers
          └── ... any topic the user owns
\`\`\`

Every fact must trace back to the user through this tree. If it doesn't → skip.

## WHAT TO EXTRACT

**Relationships** — the most important world fact. Every person must be connected — either to the user directly or to a topic the user owns.
- Ask: "How would the user introduce this person?" Strip away the channel and the action.
- Direct: User → role → Person | "Person is the user's [role]." (doctor, teammate, customer)
- Via topic: Topic → role → Person | "James presented at the Tech Summit." (speaker, contributor, vendor)
- Infer the relationship from context — an email thread about product setup implies a customer, a meeting about a deal implies a partner or investor.
- Put the person's own details (title, company, email, phone) in entity attributes, not graph facts.
- Examples: "Dr. Patel is the user's cardiologist", "Nina is the user's real estate agent", "Leo is on the user's team"

**Identity** — slow-changing facts about who the user IS:
- Role, location, affiliations, health metrics, personal stats
- Examples: "User lives in Bangalore", "User weighs 85 kg", "User is CTO at CORE"

**Knowledge** — facts about things the user OWNS, BUILDS, or MANAGES. Two levels:
- **User-level**: the user's relationship to the thing — "User's apartment is a 3BHK in Koramangala", "User's portfolio is 60% equity, 40% debt"
- **Topic-level**: facts about the thing itself — its features, capabilities, structure, status. These are just as important. "CORE Auto-Sync saves old ChatGPT conversations", "CORE extension works with Claude and ChatGPT", "Apartment has a balcony facing the park"
- NOT code-level implementation details (those exist in the code)
- NOT other people's products/companies (the user doesn't own them)

**Events** — things the user personally did or experienced:
- Meetings, appointments, milestones, trips, incidents
- NOT the assistant's actions in this session
- Examples: "User had annual checkup with Dr. Patel", "User signed the lease on March 5"

**Decisions** — explicit choices between alternatives:
- Examples: "User chose the fixed-rate mortgage over variable", "User decided to go with the gray cabinets"

**Problems** — ongoing issues affecting the user:
- Persistent blockers, recurring struggles
- Examples: "User's kitchen contractor keeps missing deadlines", "User's sleep quality has been poor for weeks"

## WHAT TO SKIP

**Session actions** — what happened in THIS conversation:
- "User asked assistant to...", "Assistant found...", "Assistant booked..."
- "User said go ahead", "User confirmed yes"
- "User directed attention to file X", "User suggested adding feature Y for this task"
- Step-by-step instructions the user gave the assistant for one task
- The assistant's report of what it accomplished
- One-time feature requests or task instructions tied to current in-progress work

Extract only the lasting OUTCOME, if any. "Assistant booked a flight" → the outcome is "Flight booked to Mumbai on March 20."
"User directed assistant to file X for implementation" → no lasting world fact (session navigation).

**Implementation details** — specifics about HOW something was done:
- Code-level details, file paths, commands, commit messages
- Recipe steps, form fields, configuration values
- These are in the source material. An agent reads them directly; it doesn't need them as stored facts.

**Third-party internals** — details about things the user doesn't own:
- Another company's product features, pricing, internal structure
- A restaurant's full menu, a hotel's amenities list
- UNLESS it connects to the user's world: "Evaluating Notion for project management" → extract the evaluation, not Notion's features.

**Decomposed lists** — don't split one thing into many facts:
- A wedding with 6 vendors → ONE fact: "Wedding planning involves vendors including caterer, florist, and photographer."
- An event with 8 speakers → ONE fact with key names. The episode has the full list.
- NOT separate triples for each item.

**Transient session output** — counts and statuses the assistant just reported:
- "5 unread emails", "3 available flights found", "2 appointments this week"
- These are the assistant's session output, not the user's world state.

**Duplicate facts from same episode** — one fact per concept:
- If an episode mentions a recurring reminder → ONE fact, not separate facts for "receives reminders", "reminder notifies user", "scheduled reminder".

## GRAPH FACT WRITING

**Extract what's implied, not just what's said.** Episodes rarely spell out relationships and context explicitly. "Dropped the car at Mike's garage" implies Mike is the user's mechanic — extract that even though no one said "Mike is my mechanic." "Lunch with Laura to discuss the Series A" implies Laura is an investor or advisor. Infer the structural facts that connect entities to the user's world.

**One fact per thing.** A meeting, a person's role, a project capability = ONE fact. Don't decompose attributes into separate triples.

**Summary hooks for lists.** If the episode contains a list (speakers, features, items), write one summary fact with key names. The episode holds the full list.

**Fact text starts with the source entity.** The fact must read as a complete sentence with subject and object clear. e.g., "User's blood pressure is 130/85", "Payments Integration blocked by Stripe API", "Leo is the user's teammate." Max 15 words.

**event_date**: Only for events with specific timing. Null otherwise.

**Subject levels:**
| Level | Example |
|-------|---------|
| User | Manoj → is → CTO at CORE |
| User→Topic | Manoj → leads → Database Migration |
| Topic | CORE → uses → TypeScript |

## ENTITY EXTRACTION

Extract named entities that appear in graph facts.

**Test**: "Would an agent search for this entity to find information about the user?"

**Naming**: Short (max 2-3 words), reusable. Person → name only ("Sarah" not "Sarah contact").

**Attributes** (lookup data): email, phone, company, role, location, github_url, etc.
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

Note: Examples below use "User" as a placeholder. In actual output, use the user's real name (from <user_identity>) as the source entity.

### Example 1: Doctor visit — identity, relationship, event
Episode: "Had my annual checkup with Dr. Patel today. Blood pressure is 130/85, up from last year. He said I should cut sodium and exercise more. Cholesterol is borderline at 215. Next appointment is in 6 months."

graph_facts:
- User → has_doctor → Dr. Patel | "Dr. Patel is the user's doctor." | null
- User → has → Blood Pressure | "User's blood pressure is 130/85, up from last year." | null
- User → has → Cholesterol | "User's cholesterol is borderline at 215." | null
- User → visited → Dr. Patel | "User had annual checkup with Dr. Patel." | 2026-03-13
- User → has_appointment → Dr. Patel | "User's next appointment with Dr. Patel in 6 months." | null

entities: Dr. Patel (Person, attributes: {role: "Doctor"})

Why: Relationship (doctor) is the most important fact. Health metrics are Identity (slow-changing stats). The visit is an Event. "He said cut sodium" is the doctor's advice, not a world fact — if the user adopts it, it goes in voice. Next appointment is useful for a scheduling agent.

### Example 2: Real estate and decisions
Episode: "Met with Nina, our real estate agent, about the Koramangala apartment. It's a 3BHK, 1800 sqft, asking price 1.2 crore. We decided to make an offer at 1.05 crore. Nina thinks the seller will counter at 1.15. Registration would be at the sub-registrar office in JP Nagar."

graph_facts:
- User → has_agent → Nina | "Nina is the user's real estate agent." | null
- User → considering → Koramangala Apartment | "User is considering 3BHK apartment in Koramangala, 1800 sqft, asking 1.2 crore." | null
- User → offered → Koramangala Apartment | "User offered 1.05 crore for the Koramangala apartment." | null

entities: Nina (Person, attributes: {role: "Real estate agent"}), Koramangala Apartment (Location)

Why: Relationship (agent) extracted. Property details are Knowledge (user is considering buying it). The offer is a Decision. Nina's prediction about the seller is someone else's opinion → skip. Registration office detail is a procedural fact → skip.

### Example 3: Event with long guest/speaker list — summary hook
Episode: "Wedding reception guest list finalized. Confirmed attendees: Ravi and Priya Sharma, Amit and Neha Gupta, the Patels (family of 4), Dr. Reddy and wife, Sarah and James from London, Uncle Mohan, Aunt Lakshmi, the Desais, Vikram's family (5 people), college friends group (8 people)."

graph_facts:
- User → finalized → Wedding Guest List | "User finalized wedding reception guest list, including Sharmas, Guptas, Patels, and others." | null

entities: Wedding Reception (Event)

Why: ONE summary fact as a search hook. An agent asking "who's coming to the wedding?" finds this, retrieves the episode, gets the full list. NOT 12 separate "has_guest" triples.

### Example 4: Assistant-driven task — extract outcome only
Episode: "User asked assistant to find flights to Mumbai for March 20. Assistant searched and found 3 options: IndiGo at 6am for ₹4,500, Air India at 9am for ₹5,200, Vistara at 2pm for ₹6,100. User picked the Air India flight. Assistant booked it."

graph_facts:
- User → booked → Mumbai Flight | "User booked Air India flight to Mumbai on March 20 at 9am, ₹5,200." | 2026-03-20

entities: Mumbai Flight (Event)

Why: The search process, the 3 options, and the assistant booking are session actions. The lasting outcome: a flight is booked. ONE fact captures it. An agent managing travel should find this.

### Example 5: Reminder delivery — nothing to extract
Episode: "Reminder triggered: take fish oil. Assistant said: fish oil time, take it now. User did not respond."

graph_facts: (none)
entities: (none)

Why: This is a reminder delivery — a session event. The reminder was already stored when first created. The user not responding is not a world fact.

### Example 6: Meeting with relationships and project facts
Episode: "Had a call with Leo and Sarah about the Q3 roadmap. Leo is leading the mobile team. Sarah just joined as Head of Design. We're behind on the payments integration — Stripe API keeps timing out. Decided to bring in a contractor for the frontend work. Target is to ship by end of August."

graph_facts:
- User → has_teammate → Leo | "Leo is the user's teammate, leads the mobile team." | null
- User → has_teammate → Sarah | "Sarah is the user's teammate, Head of Design, recently joined." | null
- User → discussed → Q3 Roadmap | "User discussed Q3 roadmap with Leo and Sarah." | null
- Payments Integration → has_issue → Stripe API | "Payments Integration blocked by Stripe API timing out." | null
- User → decided → Frontend Contractor | "User decided to bring in a contractor for frontend work." | null
- Q3 Roadmap → targets → August Launch | "Q3 Roadmap targets shipping by end of August." | null

entities: Leo (Person, attributes: {role: "Mobile team lead"}), Sarah (Person, attributes: {role: "Head of Design"}), Q3 Roadmap (Concept), Payments Integration (Project)

Why: Two relationships extracted (teammates with roles). The Stripe issue is a Problem connected to the user's project. The contractor is a Decision. The timeline is Knowledge about the user's roadmap. Session mechanics ("had a call") compressed into one Event fact.

## OUTPUT
Return entities and graph_facts. Empty arrays are valid — many episodes (especially session commands, reminders, and assistant-driven tasks) have zero lasting world facts.`;

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
