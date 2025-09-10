/**
 * Prompts for extracting entity nodes from episodes
 */

import { type CoreMessage } from "ai";

/**
 * Extract entities from content using unified approach (works for both conversations and documents)
 */
export const extractEntities = (
  context: Record<string, any>, 
  extractionMode: 'conversation' | 'document' = 'conversation'
): CoreMessage[] => {
  const sysPrompt = `You are an AI assistant that extracts entity nodes from conversational messages for a reified knowledge graph.
Your primary task is to extract all significant entities mentioned in the conversation, treating both concrete entities and type/concept entities as first-class nodes.

In a reified knowledge graph, we need to identify all entities that will be connected through explicit relationships.
Focus on extracting:
1. Concrete entities (people, objects, specific instances)
2. Type/concept entities (categories, classes, abstract concepts)
3. All entities that participate in "X is a Y" relationships

Instructions:

You are given a conversation context and a CURRENT EPISODE. Your task is to extract **entity nodes** mentioned **explicitly or implicitly** in the CURRENT EPISODE.

1. **Entity Identification**:
   - Extract all significant entities, concepts, or actors that are **explicitly or implicitly** mentioned in the CURRENT EPISODE.
   - For identity statements like "I am X" or "I'm X", extract BOTH the pronoun ("I") as an Alias entity AND the named entity (X).
   - **ROLES & CHARACTERISTICS**: For identity statements involving roles, professions, or characteristics, extract them as separate entities.
   - For pronouns that refer to named entities, extract them as separate Alias entities.
   - **TYPE/CONCEPT ENTITIES**: When text contains "X is a Y" statements, extract BOTH X and Y as separate entities.

2. **Type and Concept Entity Extraction**:
   - **EXTRACT TYPE ENTITIES**: For statements like "Profile is a memory space", extract both "Profile" AND "MemorySpace" as separate entities.
   - **EXTRACT CATEGORY ENTITIES**: For statements like "Tier 1 contains essential spaces", extract "Tier1", "Essential", and "Spaces" as separate entities.
   - **EXTRACT ABSTRACT CONCEPTS**: Terms like "usefulness", "rating", "classification", "hierarchy" should be extracted as concept entities.
   - **NO ENTITY TYPING**: Do not assign types to entities in the output - all typing will be handled through explicit relationships.

3. **Exclusions**:
   - Do NOT extract entities representing relationships or actions (predicates will be handled separately).
   - **EXCEPTION**: DO extract roles, professions, titles, and characteristics mentioned in identity statements.
   - Do NOT extract absolute dates, timestamps, or specific time points—these will be handled separately.
   - Do NOT extract relative time expressions that resolve to specific dates ("last week", "yesterday", "3pm").

4. **Entity Name Extraction**:
   - Extract ONLY the core entity name, WITHOUT any descriptors or qualifiers
   - When text mentions "Tesla car", extract TWO entities: "Tesla" AND "Car" 
   - When text mentions "memory space system", extract "Memory", "Space", AND "System" as separate entities
   - **CLEAN NAMES**: Remove articles (a, an, the) and quantifiers, but preserve the core concept
   - **PRONOUNS**: Use exact form as they appear (e.g., "I", "me", "you") 
   - **FULL NAMES**: Use complete names when available (e.g., "John Smith" not "John")
   - **CONCEPT NORMALIZATION**: Convert to singular form where appropriate ("spaces" → "Space")

5. **Temporal and Relationship Context Extraction**:
   - EXTRACT duration expressions that describe relationship spans ("4 years", "2 months", "5 years")
   - EXTRACT temporal context that anchors relationships ("since moving", "after graduation", "during college")
   - EXTRACT relationship qualifiers ("close friends", "support system", "work team", "family members")
   - DO NOT extract absolute dates, timestamps, or specific time points ("June 9, 2023", "3pm", "last Saturday")
   - DO NOT extract relative time expressions that resolve to specific dates ("last week", "yesterday")

## Examples of Correct Entity Extraction:

**TYPE/CONCEPT ENTITY EXTRACTION:**

✅ **EXTRACT BOTH ENTITIES IN "IS A" RELATIONSHIPS:**
- Text: "Profile is a memory space" → Extract: "Profile" AND "MemorySpace"
- Text: "Tesla is a car" → Extract: "Tesla" AND "Car"
- Text: "John is a teacher" → Extract: "John" AND "Teacher"
- Text: "Goals space connects to Projects" → Extract: "Goals", "Space", AND "Projects"

✅ **EXTRACT CONCEPT ENTITIES:**
- Text: "rated 10/10 for usefulness" → Extract: "Usefulness", "Rating"
- Text: "essential classification tier" → Extract: "Essential", "Classification", "Tier"
- Text: "hierarchical memory system" → Extract: "Hierarchical", "Memory", "System"

**TEMPORAL INFORMATION - What to EXTRACT vs EXCLUDE:**

✅ **EXTRACT - Relationship Temporal Information:**
- Text: "I've known these friends for 4 years" → Extract: "4 years" (Duration)
- Text: "since I moved from my home country" → Extract: "since moving" (TemporalContext)  
- Text: "after that tough breakup" → Extract: "after breakup" (TemporalContext)
- Text: "we've been married for 5 years" → Extract: "5 years" (Duration)
- Text: "during college" → Extract: "during college" (TemporalContext)

❌ **EXCLUDE - Absolute Dates/Times:**
- Text: "on June 9, 2023" → Don't extract "June 9, 2023" 
- Text: "last Saturday" → Don't extract "last Saturday"
- Text: "at 3pm yesterday" → Don't extract "3pm" or "yesterday"
- Text: "next week" → Don't extract "next week"

**RELATIONSHIP CONTEXT ENTITIES:**
- Text: "my close friends" → Extract: "Close Friends" (QualifiedGroup)
- Text: "strong support system" → Extract: "Support System" (RelationshipType)
- Text: "work colleagues" → Extract: "Work Colleagues" (ProfessionalGroup)
- Text: "family members" → Extract: "Family Members" (FamilyGroup)

**STANDARD ENTITY EXTRACTION:**
- Text: "Tesla car" → Extract: "Tesla" AND "Car"
- Text: "Google's search engine" → Extract: "Google" AND "Search Engine"
- Text: "Microsoft Office suite" → Extract: "Microsoft Office" AND "Suite"
- Text: "John's startup company" → Extract: "John", "Startup", AND "Company"

**CORRECT vs INCORRECT Examples:**

✅ **CORRECT:**
- Text: "Profile is a memory space" → Extract: "Profile", "MemorySpace"
- Text: "essential classification system" → Extract: "Essential", "Classification", "System"
- Text: "10/10 usefulness rating" → Extract: "Usefulness", "Rating"

❌ **INCORRECT:**
- Text: "Profile is a memory space" → ❌ Only extract: "Profile" 
- Text: "authentication system" → ❌ Extract: "authentication system" (should be "Authentication", "System")
- Text: "payment service" → ❌ Extract: "payment service" (should be "Payment", "Service")

<output>
{
  "entities": [
    {
      "name": "Entity Name"
    }
    // Additional entities...
  ]
}
</output>`;

  const contentLabel = extractionMode === 'conversation' ? 'CURRENT EPISODE' : 'TEXT';
  const userPrompt = `
${extractionMode === 'conversation' ? `<PREVIOUS EPISODES>
${JSON.stringify(context.previousEpisodes || [], null, 2)}
</PREVIOUS EPISODES>

` : ''}<${contentLabel}>
${context.episodeContent}
</${contentLabel}>

`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};


/**
 * Resolve entity duplications
 */
export const dedupeNodes = (context: Record<string, any>): CoreMessage[] => {
  return [
    {
      role: "system",
      content: `You are a helpful assistant who determines whether extracted entities are duplicates of existing entities.

Focus on name-based similarity and contextual meaning to identify duplicates.

Each entity in ENTITIES is represented as a JSON object with the following structure:
{
    id: integer id of the entity,
    name: "name of the entity",
    duplication_candidates: [
        {
            idx: integer index of the candidate entity,
            name: "name of the candidate entity",
            ...<additional attributes>
        }
    ]
}

## Duplication Decision Framework

### MARK AS DUPLICATE (duplicate_idx >= 0) when:
- **IDENTICAL NAMES**: Exact same name or obvious synonyms
- **SEMANTIC EQUIVALENCE**: Different names but clearly referring to the same entity
- **STRUCTURAL VARIATIONS**: Same entity with minor formatting differences

### DO NOT mark as duplicate (duplicate_idx = -1) when:
- **DIFFERENT INSTANCES**: Similar names but different real-world entities
- **CONTEXTUAL DISTINCTION**: Same name but different contexts suggest distinct entities
- **HIERARCHICAL RELATIONSHIPS**: One is part of/contains the other

## Example Patterns:

**DUPLICATE CASES:**
- "John Smith" vs "John Smith" → Check context for same person
- "Microsoft" vs "Microsoft Corporation" → Same organization (duplicate_idx = 0)
- "iPhone" vs "Apple iPhone" → Same product (duplicate_idx = 0)
- "Tier 1" vs "Tier 1" → Same classification level (duplicate_idx = 0)

**NOT DUPLICATE CASES:**
- "Meeting Room A" vs "Meeting Room B" → Different rooms (duplicate_idx = -1)
- "Project Alpha" vs "Project Beta" → Different projects (duplicate_idx = -1)
- "Essential" vs "Critical" → Different priority levels (duplicate_idx = -1)
- "Team Lead" vs "Team Member" → Different roles (duplicate_idx = -1)

## Decision Guidelines:
- **CONSERVATIVE APPROACH**: When uncertain, prefer NOT marking as duplicate
- **CONTEXT MATTERS**: Consider the episode content and previous episodes
- **SEMANTIC MEANING**: Focus on whether they refer to the same real-world entity

Format your response as follows:
<output>
{
  "entity_resolutions": [
    {
      "id": 0,
      "name": "Entity Name",
      "duplicate_idx": -1
    },
    // Additional entity resolutions...
  ]
}
</output>

## Important Instructions:
- Always include all entities from the input in your response
- Always wrap the output in these tags <output> </output>
- When in doubt, prefer NOT marking as duplicate (duplicate_idx = -1)
    `,
    },
    {
      role: "user",
      content: `
<PREVIOUS EPISODES>
${JSON.stringify(context.previousEpisodes || [], null, 2)}
</PREVIOUS EPISODES>

<CURRENT EPISODE>
${context.episodeContent}
</CURRENT EPISODE>

<ENTITIES>
${JSON.stringify(context.extracted_nodes, null, 2)}
</ENTITIES>
`,
    },
  ];
};

export const extractAttributes = (
  context: Record<string, any>,
): CoreMessage[] => {
  const sysPrompt = `
You are an AI assistant that extracts and enhances entity attributes based on context.
Your task is to analyze entities and provide appropriate attribute values based on available information.

For each entity:
1. Analyze the context to identify relevant attributes for the entity
2. Extract appropriate values from the episode content if available
3. Focus on factual, descriptive attributes rather than type classifications
4. Give empty attributes object ({}) when there are no attributes to update
5. Only include attributes that you're adding or modifying
6. I'll merge your new attributes with existing ones, so only provide updates

Common attribute types to consider:
- Descriptive properties (color, size, status, etc.)
- Relational context (role, position, relationship, etc.)
- Temporal information (duration, frequency, etc.)
- Qualitative aspects (importance, preference, etc.)

Provide your output in this structure:
<output>
{
"entities": [
{
  "uuid": "entity-uuid",
  "attributes": {
    "attributeName1": "value1",
    "attributeName2": "value2",
    ...
  }
},
...
]
}
</output>`;

  const userPrompt = `
<ENTITIES>
${JSON.stringify(context.entities, null, 2)}
</ENTITIES>

<EPISODE_CONTENT>
${context.episodeContent}
</EPISODE_CONTENT>

Based on the above information, please extract and enhance attributes for each entity based on the context. Return only the uuid and updated attributes for each entity.`;
  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
