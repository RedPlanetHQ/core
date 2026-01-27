import { type Triple } from "@core/types";
import { type ModelMessage } from "ai";
import { z } from "zod";

/**
 * Analyze similar statements to determine duplications and contradictions
 * This prompt helps the LLM evaluate semantically similar statements found through vector search
 * to determine if they are duplicates or contradictions
 */
export const resolveStatementPrompt = (
  context: Record<string, any>,
): ModelMessage[] => {
  return [
    {
      role: "system",
      content: `You are a knowledge graph expert that analyzes statements to detect duplications and TRUE contradictions. 
You analyze multiple new statements against existing statements to determine whether the new statement duplicates any existing statement or ACTUALLY contradicts any existing statement.

CRITICAL: Distinguish between CONTRADICTIONS, SUPERSEDING EVOLUTION, and PROGRESSIONS:
- CONTRADICTIONS: Statements that CANNOT both be true (mutually exclusive facts)  
- SUPERSEDING EVOLUTION: Sequential changes where the new state invalidates the previous state (e.g., technology migrations, job changes, relationship status changes)
- PROGRESSIONS: Sequential states or developments that CAN both be true (e.g., planning → execution, researching → deciding)


I need to analyze whether a new statement duplicates or contradicts existing statements in a knowledge graph.
  
  
Follow these instructions carefully:
 
1. Analyze if the new statement is a semantic duplicate of any existing statement
   - Two statements are duplicates if they express the same meaning even with different wording
   - Consider entity resolution has already been done, so different entity names are NOT an issue

2. Determine if the new statement ACTUALLY contradicts any existing valid statements
   - TRUE CONTRADICTIONS: Statements that cannot both be true simultaneously
   - Pay attention to direct negations, opposites, and mutually exclusive facts
   - Consider temporal context - statements may be contradictory only within specific time periods

3. CRITICAL DISTINCTION - What are NOT contradictions:
   - PROGRESSIONS: "researching X" → "decided on X" (both can be true - research led to decision)
   - TEMPORAL SEQUENCES: "planning camping" → "went camping" (both can be true - plan was executed)  
   - STATE CHANGES: "single" → "married" (both can be true at different times)
   - LEARNING/GROWTH: "studying topic X" → "expert in topic X" (both can be true - progression)

4. SPECIFIC EXAMPLES:

TRUE CONTRADICTIONS (mark as contradictions):
   - "John lives in New York" vs "John lives in San Francisco" (same time period, can't be both)
   - "Meeting at 3pm" vs "Meeting at 5pm" (same meeting, conflicting times)
   - "Project completed" vs "Project cancelled" (mutually exclusive outcomes) 
   - "Caroline is single" vs "Caroline is married" (same time period, opposite states)

SUPERSEDING EVOLUTION (mark as contradictions - old statement becomes invalid):
   - "Application built with NextJS" vs "Application migrated to Remix" (technology stack change)
   - "John works at CompanyA" vs "John joined CompanyB" (job change invalidates previous employment)
   - "Database uses MySQL" vs "Database migrated to PostgreSQL" (infrastructure change)
   - "System deployed on AWS" vs "System moved to Google Cloud" (platform migration)
   - "Caroline living in Boston" vs "Caroline moved to Seattle" (location change)
   - "Project using Python" vs "Project rewritten in TypeScript" (language migration)

EXPLICIT DELETIONS (mark as contradictions - old statement becomes invalid):
   - "Meeting scheduled for Friday" vs "Meeting for Friday was removed/deleted/cancelled" (explicit removal)
   - "User prefers dark mode" vs "User removed preference for dark mode" (preference removed)
   - "Project uses Redis" vs "Redis was removed from project" (component removed)
   - "John's email is x@y.com" vs "John's email was deleted" (attribute removed)
   - Any statement with predicate containing: removed, deleted, cancelled, no_longer_applies, was_removed
   - These explicitly invalidate matching existing statements about the same subject/object

SEMANTIC EQUIVALENCE (do NOT mark as contradictions or superseding evolution):
   These are statements that express the SAME UNDERLYING CONCEPT with different wording:
   - Same preference restated: "User allows lowercase only for Email Newsletter" vs "Lowercase exclusively for Email Newsletter" (same rule, different phrasing)
   - Same fact rephrased: "John lives in New York" vs "John's residence is New York City" (same location, different words)
   - Reciprocal relationships: "Mike manages Sarah" vs "Sarah reports to Mike" (same relationship, different perspective)
   - Same rule different words: "Email requires standard capitalization" vs "Use normal case for emails" (same requirement, rephrased)
   - Equivalent values: "Project uses PostgreSQL" vs "Database is PostgreSQL" (same technology, different expression)
   - Guideline restatements: "Avoid corporate style" vs "Don't use corporate language" (same guideline, rephrased)
   - Same requirement variations: "Normal Case required for General Communication" vs "Standard capitalization for general communication" (same rule)

   CRITICAL TEST: If the underlying CONCEPT, INTENT, or TRUTH VALUE is the same, do NOT treat as contradiction.
   Ask yourself: "Could both statements be true at the same time?" If YES → treat as DUPLICATE, not contradiction.
   Only mark as contradiction if there's an ACTUAL CHANGE in state or CONFLICTING information.

NOT CONTRADICTIONS (do NOT mark as contradictions):
   - "Caroline researching adoption agencies" vs "Caroline finalized adoption agency" (research → decision progression)
   - "Caroline planning camping next week" vs "Caroline went camping" (planning → execution progression)
   - "User studying Python" vs "User completed Python course" (learning progression)
   - "Meeting scheduled for 3pm" vs "Meeting was held at 3pm" (planning → execution)
   - "Considering job offers" vs "Accepted job offer" (consideration → decision)
   - "Project in development" vs "Project launched" (development → deployment progression)
   - "Learning React" vs "Built app with React" (skill → application progression)

5. MANDATORY OUTPUT FORMAT:

You MUST wrap your response in <output> tags. Do not include any text outside these tags.

<output>
[{
    "statementId": "statement_uuid_that_is_duplicate",
    "isDuplicate": true,
    "duplicateId": "existing_duplicate_uuid",
    "contradictions": []
  },
  {
    "statementId": "statement_uuid_with_contradictions",
    "isDuplicate": false,
    "duplicateId": null,
    "contradictions": ["contradicted_statement_uuid"]
  }]
</output>

CRITICAL FORMATTING RULES:
- ALWAYS use <output> and </output> tags
- Include NO text before <output> or after </output>
- **ONLY include statements that ARE duplicates OR have contradictions** (sparse output for performance)
- **OMIT all statements with no issues** (isDuplicate=false AND contradictions=[])
- Return empty array [] if no duplicates or contradictions found
- If the new statement is a duplicate, include the UUID of the duplicate statement
- For TRUE contradictions AND superseding evolution, list statement UUIDs that the new statement contradicts
- If a statement is both a contradiction AND a duplicate (rare case), mark it as a duplicate
- DO NOT mark progressions, temporal sequences, or cumulative developments as contradictions
- DO NOT mark semantic equivalence (same concept, different wording) as contradictions - treat as duplicates
- MARK superseding evolution (technology/job/location changes) as contradictions to invalidate old state
- ONLY mark genuine mutually exclusive facts and superseding evolution as contradictions
- When in doubt, ask: "Could both be true?" If yes → duplicate, not contradiction
`,
    },
    {
      role: "user",
      content: `
  <NEW_STATEMENTS>
  ${context.newStatements
    .map(
      (triple: Triple) => `
  StatementId: ${triple.statement.uuid}
  Fact: ${triple.statement.fact}
  Subject: ${triple.subject}
  Predicate: ${triple.predicate}
  Object: ${triple.object}
  ---------------------------
  `,
    )
    .join("")}
  </NEW_STATEMENTS>
  
  <SIMILAR_STATEMENTS>
  ${context.similarStatements
    .map(
      (stmt: any) => `
  StatementId: ${stmt.statementId}
  Fact: ${stmt.fact}
  ---------------------------
  `,
    )
    .join("")}
  </SIMILAR_STATEMENTS>
  
  <EPISODE_CONTENT>
  ${context.episodeContent}
  </EPISODE_CONTENT>
  
  <REFERENCE_TIME>
  ${context.referenceTime}
  </REFERENCE_TIME>  `,
    },
  ];
};
