import { type Triple } from "@core/types";
import { type CoreMessage } from "ai";

/**
 * Extract statements (triples) from episode content in a reified knowledge graph model
 * This function generates a prompt for LLM to extract subject-predicate-object statements
 * and represent them as first-class nodes with proper connections
 */
export const extractStatements = (
  context: Record<string, any>,
): CoreMessage[] => {
  return [
    {
      role: "system",
      content: `You are a knowledge graph expert who extracts NEW factual statements from text as subject-predicate-object triples.

CRITICAL REQUIREMENT:
- You MUST ONLY use entities from the AVAILABLE ENTITIES list as subjects and objects.
- The "source" and "target" fields in your output MUST EXACTLY MATCH entity names from the AVAILABLE ENTITIES list.
- If you cannot express a fact using only the available entities, DO NOT include that fact in your output.
- DO NOT create, invent, or modify any entity names.
- NEVER create statements where the source and target are the same entity (no self-loops).

## PRIMARY MISSION: EXTRACT NEW RELATIONSHIPS
Focus on extracting factual statements that ADD NEW VALUE to the knowledge graph:
- **PRIORITIZE**: New relationships not already captured in previous episodes
- **EMPHASIZE**: Connections between entities with same names but different types
- **FILTER**: Avoid extracting facts already present in previous episodes
- **EVOLVE**: Form relationships that enhance the existing knowledge structure

Your task is to identify NEW important facts from the provided text and represent them in a knowledge graph format.

Follow these instructions:

1. **ANALYZE PREVIOUS EPISODES**: Review previous episodes to understand what relationships already exist
2. **REVIEW AVAILABLE ENTITIES**: Carefully examine the AVAILABLE ENTITIES list - these are the ONLY entities you can use as subjects and objects
3. **IDENTIFY SAME-NAME ENTITIES**: Look for entities with identical names but different types - these often represent natural relationships that should be explicitly connected
4. **EXTRACT NEW RELATIONSHIPS**: Identify factual statements that can be expressed using ONLY available entities AND are NOT already captured in previous episodes
5. For each NEW valid statement, provide:
   - source: The subject entity (MUST be from AVAILABLE ENTITIES)
   - predicate: The relationship type (can be a descriptive phrase)
   - target: The object entity (MUST be from AVAILABLE ENTITIES)

EXTRACT NEW MEANINGFUL RELATIONSHIPS:
- Extract meaningful relationships between available entities that are NOT already captured in previous episodes
- Use predicates that accurately describe new relationships between entities
- Be creative but precise in identifying NEW relationships - focus on value-adding connections
- **HIGHEST PRIORITY**: Entities with identical names but different types MUST be connected with explicit relationship statements
- **MANDATORY**: When you find entities like "John (Person)" and "John (Company)", create explicit relationships such as "John" "owns" "John" or "John" "founded" "John"
- Look for both explicit and implicit NEW relationships mentioned in the text
- **FILTER OUT**: Relationships already established in previous episodes unless they represent updates or changes
- Common relationship types include (but are not limited to):
  * Ownership or association (e.g., "Alice" "owns" "Restaurant")
  * Participation or attendance (e.g., "Team" "participates in" "Tournament")
  * Personal connections (e.g., "Sarah" "works with" "Michael")
  * Aliases and alternative names (e.g., "Robert" "is also known as" "Bob")
  * Locations and spatial relationships (e.g., "Office" "located in" "Building")
  * Characteristics and properties (e.g., "System" "has property" "Scalability")
  * Product-organization relationships (e.g., "Software" "developed by" "Company")
  * Technical dependencies and usage (e.g., "Application" "uses" "Database")
  * Hierarchical relationships (e.g., "Manager" "supervises" "Employee")

## SAME-NAME ENTITY RELATIONSHIP FORMATION
When entities share identical names but have different types, CREATE explicit relationship statements:
- **Person-Organization**: "John (Person)" → "owns", "founded", "works for", or "leads" → "John (Company)"
- **Person-Location**: "Smith (Person)" → "lives in", "founded", or "is associated with" → "Smith (City)"
- **Event-Location**: "Conference (Event)" → "takes place at" or "is hosted by" → "Conference (Venue)"
- **Product-Company**: "Tesla (Product)" → "is manufactured by" or "is developed by" → "Tesla (Company)"
- **MANDATORY**: Always create at least one relationship statement for same-name entities
- **CONTEXT-DRIVEN**: Choose predicates that accurately reflect the most likely relationship based on available context

## PREVIOUS EPISODE FILTERING
Before creating any relationship statement:
- **CHECK**: Review previous episodes to see if this exact relationship already exists
- **SKIP**: Do not create statements that duplicate existing relationships
- **ENHANCE**: Only create statements if they add new information or represent updates
- **FOCUS**: Prioritize completely new connections not represented in the knowledge graph

ABOUT TEMPORAL INFORMATION:
- For events with dates/times, DO NOT create a separate statement with the event as both source and target.
- Instead, ADD the temporal information directly to the most relevant statement as attributes.
- Example: For "Max married to Tina on January 14", add the timespan to the "married to" relationship.
- If there are multiple statements about an event, choose the most ownership-related one to add the timespan to.

Format your response as a JSON object with the following structure:
<output>
{
  "edges": [
    {
      "source": "[Subject Entity Name - MUST be from AVAILABLE ENTITIES]",
      "sourceType": "[Source Entity Type]",
      "predicate": "[Relationship Type]",
      "target": "[Object Entity Name - MUST be from AVAILABLE ENTITIES]", 
      "targetType": "[Target Entity Type]",
      "fact": "[Natural language representation of the fact]",
      "attributes": { 
        "confidence": confidence of the fact
        "source": "explicit or implicit source type",
      }
    }
  ]
}
</output>

IMPORTANT RULES:
- **ENTITIES**: ONLY use entities from AVAILABLE ENTITIES as source and target
- **NO INVENTION**: NEVER create statements where source or target is not in AVAILABLE ENTITIES
- **NO SELF-LOOPS**: NEVER create statements where the source and target are the same entity
- **SAME-NAME PRIORITY**: When entities share names but have different types, CREATE explicit relationship statements between them
- **NEW ONLY**: Do NOT create statements that duplicate relationships already present in previous episodes
- **TEMPORAL**: Instead of creating self-loops for temporal information, add timespan attributes to relevant statements
- **FILTER FIRST**: If you cannot express a NEW fact using only available entities, omit it entirely
- **OUTPUT FORMAT**: Always wrap output in tags <output> </output>

Example of CORRECT usage:
If AVAILABLE ENTITIES contains ["John", "Max", "Wedding", "John (Company)"], you can create:
- "John" "attends" "Wedding" ✓ (if not already in previous episodes)
- "Max" "married to" "Tina" with timespan attribute ✓ (if new relationship)
- "John" "founded" "John (Company)" ✓ (PRIORITY: same name, different types)

Example of INCORRECT usage:
- "John" "attends" "Party" ✗ (if "Party" is not in AVAILABLE ENTITIES)
- "Marriage" "occurs on" "Marriage" ✗ (NEVER create self-loops)
- "John" "attends" "Wedding" ✗ (if already captured in previous episodes)
- "January 14" "is" "Marriage date" ✗ (if "January 14" or "Marriage date" is not in AVAILABLE ENTITIES)`,
    },
    {
      role: "user",
      content: `
<EPISODE_CONTENT>
${context.episodeContent}
</EPISODE_CONTENT>

<PREVIOUS_EPISODES>
${JSON.stringify(context.previousEpisodes, null, 2)}
</PREVIOUS_EPISODES>

<AVAILABLE_ENTITIES>
${JSON.stringify(context.entities, null, 2)}
</AVAILABLE_ENTITIES>
`,
    },
  ];
};

/**
 * Analyze similar statements to determine duplications and contradictions
 * This prompt helps the LLM evaluate semantically similar statements found through vector search
 * to determine if they are duplicates or contradictions
 */
export const resolveStatementPrompt = (
  context: Record<string, any>,
): CoreMessage[] => {
  return [
    {
      role: "system",
      content: `You are a knowledge graph expert that analyzes statements to detect duplications and contradictions. 
You analyze multiple new statements against existing statements to determine whether the new statement duplicates any existing statement or contradicts any existing statement.
Pay special attention to temporal aspects, event updates, and context changes. If an event changes (like a date shift), statements about the original event are likely contradicted by statements about the updated event.


I need to analyze whether a new statement duplicates or contradicts existing statements in a knowledge graph.
  
  
Follow these instructions carefully:
 
1. Analyze if the new statement is a semantic duplicate of any existing statement
   - Two statements are duplicates if they express the same meaning even with different wording
   - Consider entity resolution has already been done, so different entity names are NOT an issue

2. Determine if the new statement contradicts any existing valid statements
   - Contradictions occur when statements cannot both be true at the same time
   - Pay special attention to negations, opposites, and mutually exclusive facts
   - Consider temporal validity - statements may only be contradictions within specific time periods
   
3. IMPORTANT: For events that change (like rescheduled appointments, moved dates, changed locations):
   - When an event changes date/time/location, new statements about the updated event likely contradict statements about the original event
   - Look for contextual clues about event changes, cancellations, or rescheduling
   - Example: If "Concert on June 10" moved to "Concert on June 12", then "John attends June 10 concert" contradicts "John doesn't attend June 12 concert"

  4. Format your response as a JSON object with the following structure:
<output>
[{
    "statementId": "new_statement_uuid",
    "isDuplicate": true/false,
    "duplicateId": "existing_statement_uuid-if-duplicate-exists",
    "contradictions": ["existing_statement_uuid-1", "existing_statement_uuid-2"], // UUIDs of any contradicted statements
    }]
</output>
  
  Important guidelines:
- If the new statement is a duplicate, include the UUID of the duplicate statement
- For contradictions, list all statement UUIDs that the new statement contradicts
- If a statement is both a contradiction AND a duplicate (rare case), mark it as a duplicate
- Identify temporal and contextual shifts that may create implicit contradictions
- Don't give any reason, just give the final output.
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
  ${JSON.stringify(context.similarStatements, null, 2)}
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
