/**
 * Combined Entity + Statement Extraction Prompt v3
 * Simplified approach: 3 core questions + examples
 */

import { type ModelMessage } from "ai";
import z from "zod";
import { EntityTypes, StatementAspects } from "@core/types";

/**
 * Schema for combined extraction output
 */
export const CombinedEntitySchema = z.object({
  name: z
    .string()
    .describe("The entity name - clean, without articles or qualifiers"),
  type: z.enum(EntityTypes).describe("The entity type classification"),
  attributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional entity attributes like email, phone, location, etc."),
});

export const CombinedStatementSchema = z.object({
  source: z
    .string()
    .describe("Subject entity name - MUST be from extracted entities"),
  predicate: z.string().describe("Relationship type"),
  target: z
    .string()
    .describe(
      "Object entity name - MUST be from extracted entities OR a literal value",
    ),
  fact: z.string().describe("Natural language representation of the fact"),
  aspect: z.enum(StatementAspects).nullable().describe("Aspect classification"),
  event_date: z.string().nullable().describe("ISO date when the fact occurred"),
});

export const CombinedExtractionSchema = z.object({
  entities: z.array(CombinedEntitySchema).describe("Extracted entities"),
  statements: z.array(CombinedStatementSchema).describe("Extracted statements"),
});

export type CombinedExtraction = z.infer<typeof CombinedExtractionSchema>;

/**
 * Combined extraction prompt v3 - simplified with 3 core questions
 */
export const extractCombined = (
  context: Record<string, any>,
): ModelMessage[] => {
  const sysPrompt = `You extract ENTITIES and STATEMENTS for a user's PERSONAL KNOWLEDGE GRAPH.

<core_principles>
1. USER-CENTRIC EXTRACTION
   This is the user's personal knowledge graph - everything is implicitly about/for this user.
   Extract ONLY what's specific to this user, their projects, their plans, their relationships.

2. CONTEXT FROM GRAPH STRUCTURE, NOT FACT TEXT
   The graph structure provides context - don't repeat it in fact strings.

   ✅ CORRECT - Concise facts, context from structure:
   Statement 1: Manoj → wants → Fat Loss (Goal)
   Statement 2: Manoj → plans → 300-500 cal deficit (Action)
   Query time: LLM infers "deficit is for fat loss" from proximity

   ❌ WRONG - Verbose facts with repeated context:
   Statement: Manoj → plans → 300-500 cal deficit for Fat Loss goal
   Problem: Repeats context already in graph, wastes tokens

   KEY RULES:
   - Choose the right SUBJECT - Context comes from subject selection
   - Keep facts CONCISE - Max 15 words, no redundant context
   - Let LLM infer - Related statements + graph structure = complete context
   - No intermediate entities - Don't create "Fat Loss Plan" entity just to link facts

3. ONE FACT PER THING
   Extract EXACTLY ONE fact per distinct piece of information.
   - One fact per event/meeting - USER is the subject (they're the one taking action)
   - Don't duplicate facts for meeting participants - "A <> B meeting" = ONE fact with user as subject
   - One fact per attribute change - extract NEW values as entity attributes, not statements

4. TOPIC ANCHORS FOR TRACEABILITY
   Create topic entities (meetings, plans, projects, evaluations) to group related information.
   This enables queries like "who was in X meeting?" or "what does Y plan target?"

   Pattern: User → relates_to → Topic, then Topic → has_details → Entities

   Example - Meeting:
   • User → scheduled → Core Onboarding Meeting
   • Core Onboarding Meeting → has participant → Sarah
   Query: "Who was in core onboarding?" → finds Sarah via the meeting anchor

   Example - Plan:
   • User → leads → Migration Plan
   • Migration Plan → targets → zero downtime
   • Migration Plan → uses → PostgreSQL 16
   Query: "What database for migration?" → finds PostgreSQL via the plan anchor

   Without topic anchors, you can't trace "who/what belongs to this topic"

5. SPECIFICITY TEST
   "Is this specific to THIS user or would it apply to anyone?"
   - ✅ "Manoj has 31% body fat" (specific to Manoj)
   - ❌ "Protein preserves muscle during deficit" (applies to everyone)
</core_principles>

<extraction_logic>
For each piece of information, ask these 4 questions:

1. WHO SAID this? → If "the assistant suggested/offered/provided", it's NOT a user fact. Consider skipping.
2. WHO/WHAT is this about? → That's your SUBJECT
3. WHAT is being said about it? → That's your PREDICATE + OBJECT
4. Is this USER-SPECIFIC? → If no, SKIP
</extraction_logic>

<subject_selection>
THREE LEVELS - you MUST use all three where applicable:

| Level | When to Use | Subject | Aspect |
|-------|-------------|---------|--------|
| User | Identity, relationships, reasoning, decisions | User's name | Identity, Relationship, Belief, Decision, Goal, Preference |
| User→Topic | How user relates to a topic/feature | User's name | Goal, Action, Decision |
| Topic | What a plan/feature/project contains or targets | Topic entity | null (usually) |

WHEN USER NAME IS NEEDED (Level: User or User→Topic):
- Identity facts: height, weight, body fat, role, location
- Relationships: works_with, knows, manages
- User-to-topic: works_on, evaluates, studies, wants, considers
- Personal actions: discussed, attended, decided, scheduled, created
- Events/meetings user organizes: "User <> Person X meeting" → User scheduled meeting

WHEN USER NAME IS NOT NEEDED (Level: Topic):
- Plan/strategy details (implicitly user's)
- Project facts (CORE → uses → TypeScript)
- System/component facts (API → supports → pagination)

ALWAYS CREATE TOPIC ANCHORS when user discusses:
• A plan with specific targets → "Migration Plan", "Launch Strategy"
• A feature being built → "Search Pipeline", "Auth Flow"
• A system with components → "API Gateway", "Notification System"
• An evaluation/analysis → "Reranker Evaluation", "Performance Audit"

EXAMPLE - Project migration discussion should extract ALL THREE LEVELS:

User level (identity):
• Manoj | works at | Acme Corp | Identity

User→Topic level (relationship to topic):
• Manoj | leads | Database Migration | Goal
• Manoj | decided | use blue-green deployment | Decision

Topic level (what the plan contains):
• Migration Plan | targets | zero downtime | null
• Migration Plan | uses | PostgreSQL 16 | null
• Migration Plan | schedules | Q2 completion | null

WITHOUT topic-level facts, searches like "migration deadline" or "deployment strategy" will miss!

KEY: If there are specific numbers, targets, or details discussed, CREATE A TOPIC ANCHOR and attach them.
</subject_selection>

<entity_extraction>
Extract entities for:
• People mentioned (with attributes for contact info)
• Features/Components being built or modified
• Projects, technologies, products involved

ENTITY TEST: "Would I search for this entity to find user-specific information?"
- ✅ "Fat Loss" - Yes, to find user's fat loss goals/progress
- ✅ "CORE" - Yes, to find project details
- ❌ "Compound Movement" - No, this is just fitness vocabulary
- ❌ "Progressive Overload" - No, this is a generic training concept

ENTITY NAMING:
Person entities - use the person's NAME only:
✓ "Sarah", "John Smith", "Dr. Chen"
✗ "Sarah contact", "John's profile", "Dr. Chen info"

Other entities - use the actual name of the thing:
✓ "Auth Flow", "User Dashboard", "Payment Gateway" (feature/component names)
✓ "Q2 Roadmap", "API Redesign" (named plans/initiatives)
✗ "Auth Flow changes", "new User Dashboard" (action + name)

Keep names SHORT (max 2-3 words):
✓ "Connection Pooling", "Code Review", "Authentication"
✗ "database connection pooling", "code review process", "authentication flow implementation"

Entity names must be REUSABLE across episodes for deduplication.

ENTITY ATTRIBUTES (for lookup and metadata):

Attributes store lookup data and metadata on entities:
- Person: email, phone, company, role, location
- Place: address, city, country
- Project: github_url, repository, status
- Task: task_id, status, priority
- Product: version, url, license

CRITICAL: Entities with attributes MUST have at least one statement to be saved to the graph.

Examples:

1. OTHER PEOPLE's contact info:
   Episode: "Update Sarah's email to sarah@acme.com, she's now at Design Co as Senior Engineer"
   → Entity: Sarah (Person) with attributes: {email: "sarah@acme.com", company: "Design Co", role: "Senior Engineer"}
   → Statement: User → updated_contact → Sarah (Relationship aspect)

2. PROJECT metadata:
   Episode: "CORE repo is at github.com/acme/core, currently in beta"
   → Entity: CORE (Project) with attributes: {github_url: "github.com/acme/core", status: "beta"}
   → Statement: CORE → has → active development (null aspect)

3. PRODUCT version:
   Episode: "PostgreSQL 16 added better JSON support"
   → Entity: PostgreSQL 16 (Product) with attributes: {version: "16"}
   → Statement: PostgreSQL 16 → supports → JSON (null aspect)

IMPORTANT: User's identity → statements with Identity aspect (for history tracking)
           Everything else → entity attributes + at least one statement (for saving)

<entity_types>
10 types - use as guidance, pick the closest fit:

| Type | Description | Examples | What to avoid |
|------|-------------|----------|---------------|
| **Person** | Named individuals, contacts | Sarah, John Smith, Dr. Chen, Dan Abramov | Generic roles ("developer", "manager") |
| **Organization** | Companies, teams, institutions | Google, Red Planet, Design Team, Stanford | Department names without company context |
| **Place** | Physical locations, cities, venues | Bangalore, San Francisco, Office HQ, District (venue) | Online communities, virtual spaces |
| **Event** | Named occurrences, meetings, conferences | React Conf, Sprint Review, Q2 Planning, Product Demo | Generic activities ("meeting", "call") |
| **Project** | Work initiatives, named efforts | CORE, MVP Launch, Website Redesign, Migration Plan | Generic work ("development", "testing") |
| **Task** | Tracked work items with IDs | CORE-123, Issue #456, TODO-789, JIRA-5001 | Tasks without tracking IDs |
| **Technology** | Dev tools, frameworks, languages, infrastructure | TypeScript, PostgreSQL, Docker, npm, AWS, Kubernetes, React | Business software (use Product) |
| **Product** | Apps, services, platforms, business software | Slack, GitHub, Perplexity, Figma, iPhone, Zomato, Cult.fit, Reddit | Programming languages/frameworks (use Technology) |
| **Standard** | Protocols, methodologies, specifications | OAuth 2.0, REST API, Agile, HTTP, JSON, Scrum | Generic terms ("best practices") |
| **Concept** | Topics, domains, categories, communities | Product Management, AI, Fat Loss, claudeai subreddit, Stocks, Mutual Funds | Textbook vocabulary |

**Key distinctions:**

Place vs Concept for communities:
- ✅ Place: "District" (physical venue), "Bangalore" (city)
- ✅ Concept: "claudeai subreddit" (online community/topic), "productmanagement subreddit"

Technology vs Product:
- ✅ Technology: TypeScript, Docker, AWS, PostgreSQL (dev tools, infrastructure)
- ✅ Product: Slack, GitHub, Perplexity, Figma (business apps, end-user services)
- Rule: If developers use it to build things → Technology. If users/teams use it to do work → Product.

Product vs Concept for categories:
- ✅ Product: Zomato Gold (specific service), iPhone (specific product)
- ✅ Concept: Stocks, Mutual Funds, Investments (categories, not specific products)

**Don't overthink typing:**
The type helps with organization, but the relationships matter more. When ambiguous, use the closest fit (e.g., subreddits could be Concept or Place - either works). Focus on extracting the right entities and statements, not perfect categorization.

SKIP generic vocabulary: Compound Movement, Progressive Overload, Calorie Deficit, Best Practices
</entity_types>

<entity_attributes>
Use attributes for LOOKUP DATA (especially for other people):

Person (other than user): email, phone, company, role
Place: address, city, country
Project: github_url, repository
Task: task_id, status
Product: version, url

Example:
{"name": "Sarah", "type": "Person", "attributes": {"email": "sarah@acme.ai"}}

IMPORTANT: User's identity → statements (for history tracking)
           Other people's identity → entity attributes (for lookup)
</entity_attributes>

<aspects>
Aspect is OPTIONAL - only use when it clearly fits. Default to null when uncertain.

CLASSIFICATION DECISION FRAMEWORK:
Before assigning an aspect, ask these questions in order:
1. WHO said this? → If "the assistant suggested/offered/provided", it's NOT a user fact. Skip or use null.
2. Is this about who the user IS? → Identity
3. Is this a connection to another person? → Relationship (capture role, company, context)
4. Is the user telling the agent how to behave? → Directive
5. Did the user explicitly choose between alternatives? → Decision
6. Is the user expressing an opinion or value? → Belief
7. Is the user describing how they want things done? → Preference
8. Is this a repeated behavior/habit? → Action
9. Is this something the user wants to achieve? → Goal
10. Did something happen at a specific time? → Event
11. Is this a blocker, challenge, or struggle? → Problem
12. Is this about what the user knows/is skilled in? → Knowledge

<aspect_identity>
IDENTITY: Who the user IS (slow-changing personal facts)
Agent question: "Who am I talking to? How do I reach them?"

IDENTIFY BY: Statements about the user's name, role, profession, company, location, physical stats, dietary identity, health metrics, affiliations, credentials.

THINK: "Would this answer change rarely (months/years)?" If yes → Identity.

COMMON MISCLASSIFICATIONS:
- Health metrics (weight, body fat, cholesterol) → Identity, NOT Event
- Dietary identity ("vegetarian", "vegan") → Identity, NOT Preference
- Professional role ("CTO at Acme") → Identity, NOT Relationship
</aspect_identity>

<aspect_knowledge>
KNOWLEDGE: What the user knows (expertise, skills)
Agent question: "What do they know? So I calibrate complexity."

IDENTIFY BY: Skills, technologies mastered, domains of expertise, certifications, tools they're proficient in.

THINK: "Does this describe the user's capability or expertise level?" If yes → Knowledge.
</aspect_knowledge>

<aspect_belief>
BELIEF: Why the user thinks the way they do (values, opinions, principles)
Agent question: "What do they believe? So I align with their values."

IDENTIFY BY: Opinions expressed about how things should work, values stated, principles articulated, reasoning about why one approach is better than another.

THINK: "Is the user expressing a value judgment or opinion about how things should be?" If yes → Belief.

COMMON MISCLASSIFICATIONS:
- "Transparency builds more credibility than polished marketing" → Belief, NOT Preference
- "Developer communities have a high BS detector" → Belief, NOT Knowledge
- "AI memory should be tool-agnostic" → Belief, NOT Goal
</aspect_belief>

<aspect_preference>
PREFERENCE: How the user wants things done (style, format, approach)
Agent question: "How do they want things? Style, format, approach."

IDENTIFY BY: Explicit likes/dislikes about how work is done, communication style, formatting choices, tool preferences, workflow style.

THINK: "Is the user describing HOW they want something done (style/format), not WHAT they believe?" If yes → Preference.

COMMON MISCLASSIFICATIONS:
- "Prefers Proper Case for emails" → Preference (style choice)
- "Transparency is more credible" → Belief, NOT Preference (value judgment)
</aspect_preference>

<aspect_action>
ACTION: What the user does regularly (habits, behaviors, routines)
Agent question: "What do they do regularly? So I fit into their life."

IDENTIFY BY: Recurring behaviors, established workflows, daily/weekly habits, regular practices.

THINK: "Does the user do this REPEATEDLY as a pattern?" If yes → Action. If it happened once → Event.

COMMON MISCLASSIFICATIONS:
- "Logs water intake via WhatsApp daily" → Action (recurring habit)
- "Logged water intake today" → Event (one-time occurrence)
- "Discussed backfilling old chat history" → Event, NOT Action
</aspect_action>

<aspect_goal>
GOAL: What the user wants to achieve (confirmed by user)
Agent question: "What are they trying to achieve? So I align suggestions."

IDENTIFY BY: User explicitly stating what they want to accomplish, targets they've set, outcomes they're working toward.

THINK: "Did the USER explicitly state they want to achieve this?" If yes → Goal. If the assistant recommended it and user didn't confirm → NOT a Goal.

CRITICAL: Assistant recommendations that the user has NOT confirmed are NOT Goals.
- "The assistant suggested leading with cross-tool portability" → NOT a user Goal, skip it
- "User wants to lose weight" (user said this) → Goal
</aspect_goal>

<aspect_directive>
DIRECTIVE: Instructions for how the agent should behave (standing rules)
Agent question: "What rules must I follow?"

IDENTIFY BY: User telling the agent what to always/never do, handling rules, automation triggers, content rules, notification preferences, things to ignore or surface.

THINK: "Is the user giving the agent a standing instruction about how to behave going forward?" If yes → Directive.

COMMON MISCLASSIFICATIONS:
- "Don't use Commenda, treat their emails as spam" → Directive (agent behavior rule), NOT Decision
- "Always use Proper Case for emails" → Directive (standing rule), NOT Preference
- "Notify me at 3PM for water check" → Directive (automation trigger)
- "Bug issue titles must start with [bug]:" → Directive (formatting rule)

KEY DISTINCTION FROM DECISION: A Directive tells the agent what to DO going forward. A Decision records a choice the user MADE between alternatives.
</aspect_directive>

<aspect_decision>
DECISION: Explicit choices the user made between alternatives
Agent question: "What's already decided? Don't suggest alternatives."

IDENTIFY BY: User explicitly chose option A over option B, selected a specific approach after considering alternatives, made a strategic/architectural/lifestyle choice.

THINK: "Did the user actively CHOOSE between alternatives?" If yes → Decision. If they're just telling the agent how to behave → Directive.

COMMON MISCLASSIFICATIONS:
- "Chose PostgreSQL over MySQL" → Decision (chose between alternatives)
- "Don't show me Commenda emails" → Directive, NOT Decision (agent instruction)
- Assistant recommended something user didn't confirm → NOT a Decision
</aspect_decision>

<aspect_event>
EVENT: Specific occurrences with timestamps
Agent question: "What happened when?"

IDENTIFY BY: Something that happened at a specific time - meetings, calls, completions, milestones, one-time actions.

THINK: "Did this happen at a specific point in time?" If yes → Event. If it's a recurring behavior → Action.

NOTE: Always include event_date for Event aspect.
</aspect_event>

<aspect_problem>
PROBLEM: Blockers, challenges, struggles (technical, behavioral, systemic)
Agent question: "What's blocking them? Where can I help?"

IDENTIFY BY: Technical issues, recurring bugs, behavioral struggles, systemic blockers, operational challenges, health hurdles.

THINK: "Is this something that's blocking progress or causing ongoing difficulty?" If yes → Problem.

CAPTURE DEPTH: Don't just capture surface symptoms. Look for patterns:
- "Google Sheets connection returns 502 errors" → Problem (technical)
- "Struggles with converting health knowledge into daily action" → Problem (behavioral)
- "Context compaction causes memory loss" → Problem (systemic)
</aspect_problem>

<aspect_relationship>
RELATIONSHIP: Connections between the user and other people
Agent question: "Who matters to them? Context for names mentioned."

IDENTIFY BY: When a person is mentioned, capture WHO they are, their ROLE, their COMPANY/ORG, and HOW the user relates to them.

THINK: "Is a person being mentioned with context about who they are or how the user knows them?" If yes → Relationship.

ALWAYS CAPTURE: When extracting a Relationship, ensure the person entity has attributes (role, company, email if available) AND the relationship statement describes the connection type.

COMMON MISCLASSIFICATIONS:
- "Had a call with Kabir from CrazeHQ" → Extract Relationship (Kabir, CrazeHQ co-founder, customer) + Event (the call)
- "Works with Sarah on CORE" → Relationship, NOT Action
- "Commenda is a former vendor, designated as spam" → Relationship (vendor status) + Directive (spam handling)
</aspect_relationship>
</aspects>

<event_date>
ONLY use event_date for Event aspect (occurrences with specific timing):
- "Attended React Conf on Jan 15" → event_date: 2026-01-15
- "Meeting scheduled for Jan 30" → event_date: 2026-01-30

Leave null for all other aspects (most facts are timeless):
- "CORE uses TypeScript" → null
- "Manoj prefers dark mode" → null
- "slack_list_messages supports pagination" → null

NEVER put timestamps as the object - use event_date field instead.
</event_date>

<skip_rules>
SKIP these - they add no value:

• Textbook facts: "Compound movements build muscle", "Protein preserves lean mass"
• Generic relationships: "Strength Training uses Progressive Overload", "Recovery uses Sleep"
• Unconfirmed assistant recommendations: If normalized text says "the assistant suggested/offered/provided X" and user did NOT confirm → SKIP
• Assistant analysis/reasoning: "The assistant explained why X works" → SKIP (not a user fact)
• Session process: "sent invite", "created", "updated" - extract the RESULT (scheduled meeting, new value), not the action
• Boilerplate: standard auth requirements, error handling, HTTP status codes, CSS classes, UI text strings
• Redundant facts: same info for multiple participants - "A <> B meeting" = ONE fact with user as subject, NOT facts for both A and B
</skip_rules>

<speaker_attribution>
CRITICAL: The normalized episode distinguishes between user and assistant statements.

DETECTION PATTERNS:
- "The assistant suggested/offered/provided/reported/stated X" → Assistant's content
- "User decided/instructed/stated/confirmed/asked X" → User's content
- "[UserName] asked/wants/prefers/decided/instructed X" → User's content

RULES:
1. Assistant suggestions NOT confirmed by user → SKIP (don't extract as user fact)
2. Assistant-provided information → Extract as topic-level facts with null aspect, NOT as user Goals/Decisions/Beliefs
3. User confirmed assistant suggestion → Extract as user Decision
4. "The assistant offered X; user did not confirm" → SKIP entirely

EXAMPLES:
- "The assistant suggested leading with cross-tool portability" → SKIP (not a user Goal)
- "The assistant provided search results showing context anxiety" → Extract as topic fact (null aspect), NOT "User believes context anxiety is #1 issue"
- "User decided to use PostgreSQL after assistant recommendation" → Decision (user confirmed)
</speaker_attribution>

<negative_patterns>
CAPTURE EXPLICIT NEGATIONS:

When text says "X (not Y)" or "X, not Y", extract BOTH:
1. The positive: prefers/uses X
2. The negative: avoids Y

Examples:
| Pattern | Extract As |
|---------|------------|
| "Normal case (not lowercase)" | prefers normal case + avoids all lowercase |
| "Short forms, not full names" | prefers short forms + avoids full names |
| "Direct, not formal" | prefers direct style + avoids formal style |
| "Use X, not Y" | prefers X + avoids Y |

Don't miss parenthetical negations!
</negative_patterns>

<fact_writing>
Keep facts SHORT: max 15 words, one clear sentence.

✗ "John prefers to have meetings in morning because productivity is higher"
✓ "John prefers morning meetings."
</fact_writing>

<output_format>
{
  "entities": [
    {"name": "Name", "type": "Type", "attributes": {"key": "value"}}
  ],
  "statements": [
    {
      "source": "Subject",
      "predicate": "relationship",
      "target": "Object",
      "fact": "Natural language fact",
      "aspect": "Aspect or null",
      "event_date": "YYYY-MM-DD or null"
    }
  ]
}
</output_format>

<examples>
EXAMPLE 1: User scheduling meeting

Episode: "Create calendar invite for John <> Sarah. Product demo walkthrough. Time: 2pm Feb 15 for 45 mins. Email: sarah@acme.com"

Entities:
[
  {"name": "John", "type": "Person"},
  {"name": "Sarah", "type": "Person", "attributes": {"email": "sarah@acme.com"}},
  {"name": "Product Demo Walkthrough", "type": "Event"}
]

Statements:
| Source | Predicate | Target | Fact | Aspect | event_date |
|--------|-----------|--------|------|--------|------------|
| John | scheduled | Product Demo Walkthrough | John scheduled Product Demo Walkthrough. | Event | 2026-02-15T14:00:00 |

Key points:
• Sarah's email → entity attributes (not a statement)
• ONE fact for the meeting - not "sent invite" AND "scheduled meeting"
• Don't include "with Sarah" in fact - graph structure captures participants
• event_date has the meeting time

---

EXAMPLE 2: Code changes

Episode: "Updated slack_list_messages: added cursor pagination, removed 20-message limit, returns full message text as JSON array."

Entities:
[
  {"name": "Manoj", "type": "Person"},
  {"name": "slack_list_messages", "type": "Technology"},
  {"name": "Slack Integration", "type": "Project"}
]

Statements:
| Source | Predicate | Target | Fact | Aspect | event_date |
|--------|-----------|--------|------|--------|------------|
| Manoj | updated | slack_list_messages | Manoj added pagination to slack_list_messages. | null | 2026-01-21 |
| slack_list_messages | uses | cursor pagination | slack_list_messages uses cursor-based pagination. | null | null |
| slack_list_messages | returns | full messages as JSON | slack_list_messages returns full message content as JSON. | null | null |

Key points:
• High-level summary, not line-by-line details
• Subject is the thing being described (slack_list_messages)
• Aspects are null (technical facts)

---

EXAMPLE 3: User goals and plans

Episode: "I want to lose fat. Planning 300-500 cal deficit and 110-145g protein daily. Current body fat is 31%."

Entities:
[
  {"name": "Manoj", "type": "Person"},
  {"name": "Fat Loss", "type": "Concept"}
]

Statements:
| Source | Predicate | Target | Fact | Aspect | event_date |
|--------|-----------|--------|------|--------|------------|
| Manoj | wants | Fat Loss | Manoj wants to lose fat. | Goal | null |
| Manoj | has | 31% body fat | Manoj has 31% body fat. | Identity | null |
| Manoj | plans | 300-500 cal deficit | Manoj plans 300-500 cal deficit. | null | null |
| Manoj | plans | 110-145g protein daily | Manoj plans 110-145g protein daily. | null | null |

Key points:
• Goal aspect for "wants"
• Identity aspect for body stats
• null aspect for plan details (not a clear category)
• No redundant "for Fat Loss" in each fact - context is in graph structure

---

EXAMPLE 4: Project tech stack

Episode: "CORE uses TypeScript, Remix for frontend, Prisma ORM. Decided to use PostgreSQL."

Entities:
[
  {"name": "CORE", "type": "Project"},
  {"name": "TypeScript", "type": "Technology"},
  {"name": "Remix", "type": "Technology"},
  {"name": "Prisma", "type": "Technology"},
  {"name": "PostgreSQL", "type": "Technology"}
]

Statements:
| Source | Predicate | Target | Fact | Aspect | event_date |
|--------|-----------|--------|------|--------|------------|
| CORE | uses | TypeScript | CORE uses TypeScript. | null | null |
| CORE | uses | Remix | CORE uses Remix for frontend. | null | null |
| CORE | uses | Prisma | CORE uses Prisma for ORM. | null | null |
| CORE | decided | PostgreSQL | CORE decided to use PostgreSQL. | Decision | null |

Key points:
• Subject is CORE (project owns its tech stack)
• NOT "Manoj uses TypeScript for CORE" (verbose)
• Decision aspect only for explicit choice
</examples>`;

  const userIdentitySection = context.userName
    ? `<user_identity>
The user is: ${context.userName}
Extract facts about ${context.userName} and their projects/work.
</user_identity>

`
    : "";

  const userPrompt = `${userIdentitySection}<episode>
${context.episodeContent}
</episode>

Extract entities and statements using the 4-question logic:
1. Who SAID this? → If assistant said it and user didn't confirm, skip
2. Who/what is this about? → Subject
3. What is being said? → Predicate + Object
4. Is this user-specific? → If no, skip`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
