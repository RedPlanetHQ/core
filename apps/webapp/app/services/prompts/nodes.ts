/**
 * Prompts for extracting entity nodes from episodes
 */

import { type CoreMessage } from "ai";

/**
 * Extract entities from an episode using message-based approach
 */
export const extractMessage = (context: Record<string, any>): CoreMessage[] => {
  const sysPrompt = `You are an AI assistant that extracts entity nodes from conversational messages for a reified knowledge graph.
Your primary task is to extract and classify significant entities mentioned in the conversation.

In a reified knowledge graph, we need to identify subject and object entities that will be connected through statements.
Focus on extracting:
1. Subject entities (people, objects, concepts)
2. Object entities (people, objects, concepts)

Instructions:

You are given a conversation context and a CURRENT EPISODE. Your task is to extract **entity nodes** mentioned **explicitly or implicitly** in the CURRENT EPISODE.

1. **Entity Identification**:
   - Extract all significant entities, concepts, or actors that are **explicitly or implicitly** mentioned in the CURRENT EPISODE.
   - For identity statements like "I am X" or "I'm X", extract BOTH the pronoun ("I") as a Alias entity AND the named entity (X).
   - For pronouns that refer to named entities, extract them as separate Alias entities.

2. **Entity Classification**:
   - Prefer using appropriate types from the ENTITY_TYPES section when they fit naturally.
   - DO NOT force-fit entities into inappropriate types from ENTITY_TYPES.
   - If no type from ENTITY_TYPES fits naturally, create a descriptive type based on context (e.g., "memory_graph_system", "authentication_bug").
   - Each entity should have exactly ONE type that best describes what it is.
   - Classify pronouns (I, me, you, etc.) as "Alias" entities.

3. **Exclusions**:
   - Do NOT extract entities representing relationships or actions (predicates will be handled separately).
   - Do NOT extract dates, times, or other temporal information—these will be handled separately.

4. **Entity Name Extraction**:
   - Extract ONLY the core entity name, WITHOUT any type descriptors or qualifiers
   - When text mentions "Tesla car", extract name as "Tesla" with type "Vehicle" 
   - When text mentions "John's company", extract name as "John" with type "Person" (company is a separate entity)
   - **CLEAN NAMES**: Remove type words like "app", "system", "platform", "tool", "service", "company", "organization" from the entity name
   - **PRONOUNS**: Use exact form as they appear (e.g., "I", "me", "you") and classify as "Alias"
   - **FULL NAMES**: Use complete names when available (e.g., "John Smith" not "John")
   - **NO TYPE SUFFIXES**: Never append the entity type to the entity name

## Examples of Correct Entity Extraction:

**CORRECT Examples:**
- Text: "Tesla car" → Name: "Tesla", Type: "Vehicle"
- Text: "Google's search engine" → Name: "Google", Type: "Company" + Name: "Search Engine", Type: "Product"
- Text: "Microsoft Office suite" → Name: "Microsoft Office", Type: "Software"
- Text: "John's startup company" → Name: "John", Type: "Person" + Name: "Startup", Type: "Company"

**INCORRECT Examples:**
- Text: "Tesla car" → ❌ Name: "Tesla car", Type: "Vehicle"
- Text: "authentication system" → ❌ Name: "authentication system", Type: "System"
- Text: "payment service" → ❌ Name: "payment service", Type: "Service"

Format your response as a JSON object with the following structure:
<output>
{
  "entities": [
    {
      "name": "Entity Name",
      "type": "Entity Type",
    }
    // Additional entities...
  ]
}
</output>`;

  const userPrompt = `
<PREVIOUS EPISODES>
${JSON.stringify(context.previousEpisodes || [], null, 2)}
</PREVIOUS EPISODES>

<CURRENT EPISODE>
${context.episodeContent}
</CURRENT EPISODE>

<ENTITY_TYPES>
${JSON.stringify(context.entityTypes || {}, null, 2)}
</ENTITY_TYPES>

`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};

/**
 * Extract entities from text-based content
 */
export const extractText = (context: Record<string, any>): CoreMessage[] => {
  const sysPrompt = `
You are an AI assistant that extracts entity nodes from text for a reified knowledge graph.
Your primary task is to extract and classify significant entities mentioned in the provided text.

In a reified knowledge graph, we need to identify subject and object entities that will be connected through statements.
Focus on extracting:
1. Subject entities
2. Object entities 

Instructions:

You are given a TEXT. Your task is to extract **entity nodes** mentioned **explicitly or implicitly** in the TEXT.

1. **Entity Identification**:
   - Extract all significant entities, concepts, or actors that are **explicitly or implicitly** mentioned in the TEXT.
   - For identity statements like "I am X" or "I'm X", extract BOTH the pronoun ("I") as a Alias entity AND the named entity (X).
   - For pronouns that refer to named entities, extract them as separate Alias entities.

2. **Entity Classification**:
   - Prefer using appropriate types from the ENTITY_TYPES section when they fit naturally.
   - DO NOT force-fit entities into inappropriate types from ENTITY_TYPES.
   - If no type from ENTITY_TYPES fits naturally, create a descriptive type based on context.
   - Each entity should have exactly ONE type that best describes what it is.
   - Classify pronouns (I, me, you, etc.) as "Alias" entities.

3. **Exclusions**:
   - Do NOT extract entities representing relationships or actions (predicates will be handled separately).
   - Do NOT extract dates, times, or other temporal information—these will be handled separately.

4. **Entity Name Extraction**:
   - Extract ONLY the core entity name, WITHOUT any type descriptors or qualifiers
   - When text mentions "Tesla car", extract name as "Tesla" with type "Vehicle" 
   - When text mentions "John's company", extract name as "John" with type "Person" (company is a separate entity)
   - **CLEAN NAMES**: Remove type words like "app", "system", "platform", "tool", "service", "company", "organization" from the entity name
   - **PRONOUNS**: Use exact form as they appear (e.g., "I", "me", "you") and classify as "Alias"
   - **FULL NAMES**: Use complete names when available (e.g., "John Smith" not "John")
   - **NO TYPE SUFFIXES**: Never append the entity type to the entity name

## Examples of Correct Entity Extraction:

**CORRECT Examples:**
- Text: "Tesla car" → Name: "Tesla", Type: "Vehicle"
- Text: "Google's search engine" → Name: "Google", Type: "Company" + Name: "Search Engine", Type: "Product"
- Text: "Microsoft Office suite" → Name: "Microsoft Office", Type: "Software"
- Text: "John's startup company" → Name: "John", Type: "Person" + Name: "Startup", Type: "Company"

**INCORRECT Examples:**
- Text: "Tesla car" → ❌ Name: "Tesla car", Type: "Vehicle"
- Text: "authentication system" → ❌ Name: "authentication system", Type: "System"
- Text: "payment service" → ❌ Name: "payment service", Type: "Service"

Format your response as a JSON object with the following structure:
<output>
{
  "entities": [
    {
      "name": "Entity Name",
      "type": "Entity Type"
    }
    // Additional entities...
  ]
}
</output>`;
  const userPrompt = `
<TEXT>
${context.episodeContent}
</TEXT>

<ENTITY_TYPES>
${JSON.stringify(context.entityTypes || {}, null, 2)}
</ENTITY_TYPES>
`;

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};

/**
 * Extract entities from an episode using JSON-based approach
 */
export const extractJson = (context: Record<string, any>): CoreMessage[] => {
  const sysPrompt = `You are an AI assistant that extracts entity nodes from text. 
Your primary task is to extract and classify significant entities mentioned in the content.`;

  const userPrompt = `
<PREVIOUS EPISODES>
${JSON.stringify(context.previousEpisodes || [], null, 2)}
</PREVIOUS EPISODES>

<CURRENT EPISODE>
${context.episodeContent}
</CURRENT EPISODE>

<ENTITY TYPES>
${JSON.stringify(context.entityTypes || {}, null, 2)}
</ENTITY TYPES>

Instructions:

Extract all significant entities mentioned in the CURRENT EPISODE. For each entity, provide a name and type.
Respond with a JSON object containing an "entities" array of objects, each with "name" and "type" properties.

Guidelines:
1. Extract significant entities, concepts, or actors mentioned in the content.
2. Avoid creating nodes for relationships or actions.
3. Avoid creating nodes for temporal information like dates, times or years (these will be added to edges later).
4. **CLEAN ENTITY NAMES**: Extract ONLY the core entity name WITHOUT type descriptors:
   - "Tesla car" → Name: "Tesla", Type: "Vehicle"
   - Remove words like "app", "system", "platform", "tool", "service", "company" from entity names
5. Use full names when available and avoid abbreviations.

${context.customPrompt || ""}
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
      content: `You are a helpful assistant who determines whether or not ENTITIES extracted from a conversation are duplicates of existing entities.

## CRITICAL RULE: Entity Type Matters
DO NOT mark entities with different types as duplicates, even if they have identical names.
- DO NOT mark "John" (Person) and "John" (Company) as duplicates
- DO NOT mark "Apple" (Company) and "Apple" (Fruit) as duplicates  
- DO NOT mark "Core" (App) and "Core" (Concept) as duplicates

Consider entities as potential duplicates ONLY if they have:
1. Similar or identical names AND
2. The EXACT SAME entity type

Each entity in ENTITIES is represented as a JSON object with the following structure:
{
    id: integer id of the entity,
    name: "name of the entity",
    entity_type: "ontological classification of the entity",
    entity_type_description: "Description of what the entity type represents",
    duplication_candidates: [
        {
            idx: integer index of the candidate entity,
            name: "name of the candidate entity",
            entity_type: "ontological classification of the candidate entity",
            ...<additional attributes>
        }
    ]
}

## Duplication Decision Rules
For each entity, determine if it is a duplicate of any of its duplication candidates:

### MARK AS DUPLICATE (duplicate_idx >= 0) when:
- Verify the candidate has the SAME entity_type as the current entity
- AND confirm the entities refer to the same real-world object or concept
- AND check that the names are very similar or identical

### SPECIAL RULE FOR PREDICATES:
**ALWAYS mark identical predicates as duplicates** - predicates are universal and reusable:
- Mark "is associated with" (Predicate) vs "is associated with" (Predicate) → duplicate_idx = 0 ✓
- Mark "works for" (Predicate) vs "works for" (Predicate) → duplicate_idx = 0 ✓
- Mark "owns" (Predicate) vs "owns" (Predicate) → duplicate_idx = 0 ✓

### DO NOT mark as duplicate (duplicate_idx = -1) when:
- Confirm the candidate has a DIFFERENT entity_type (even with identical names)
- Identify they are related but distinct entities
- Recognize they have similar names or purposes but refer to separate instances or concepts
- Distinguish when one is a general concept and the other is a specific instance
- **EXCEPTION**: DO NOT apply this rule to Predicates - always deduplicate identical predicates

## Examples:

**CORRECT - Mark as NOT Duplicates (Different Types):**
- Set "Tesla" (Company) vs "Tesla" (Car) → duplicate_idx = -1
- Set "Apple" (Company) vs "Apple" (Fruit) → duplicate_idx = -1
- Set "Core" (App) vs "Core" (System) → duplicate_idx = -1

**CORRECT - Mark Predicates AS Duplicates (Same Name, Same Type):**
- Set "is associated with" (Predicate) vs "is associated with" (Predicate) → duplicate_idx = 0
- Set "works for" (Predicate) vs "works for" (Predicate) → duplicate_idx = 0
- Set "owns" (Predicate) vs "owns" (Predicate) → duplicate_idx = 0

**CORRECT - Evaluate Potential Duplicates (Same Type):**
- Check if "John Smith" (Person) vs "John Smith" (Person) refer to same person
- Check if "Microsoft" (Company) vs "Microsoft Corporation" (Company) are the same company
- Check if "iPhone" (Product) vs "Apple iPhone" (Product) are the same product

**CORRECT - Mark as NOT Duplicates (Same Type, Different Instances):**
- Set "Meeting" (Event) vs "Meeting" (Event) → duplicate_idx = -1 (different meetings)
- Set "Project" (Task) vs "Project" (Task) → duplicate_idx = -1 (different projects)
- **NOTE**: DO NOT apply this rule to Predicates - always deduplicate identical predicates

## Task:
Provide your response as a JSON object with an "entity_resolutions" array containing one entry for each entity.

For each entity, include:
- "id": the id of the entity (integer)
- "name": the name of the entity (string)  
- "duplicate_idx": the index of the duplicate candidate, or -1 if no duplicate (integer)

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
- FIRST check if entity types match before considering any duplication
- If entity types don't match, immediately set duplicate_idx = -1
- Only mark entities with identical types as potential duplicates
- When in doubt, prefer NOT marking as duplicate (duplicate_idx = -1)
- Always include all entities from the input in your response
- Always wrap the output in these tags <output> </output>
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
Your task is to analyze entities and provide appropriate attribute values for each entity based on its type definition.

For each entity:
1. Look at its type and identify the required and optional attributes from the entity type definitions
2. Check if the entity already has values for these attributes
3. For missing attributes, extract appropriate values from the context if possible
4. For existing attributes, enhance or correct them if needed based on the context
5. Give empty attributes object ({}) when there are no attributes to update
6. Only include attributes that you're updating - don't repeat existing attributes that don't need changes
7. I'll merge your new attributes with the current attributes, so only provide values that should be added or modified

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
<ENTITY_TYPES>
${JSON.stringify(context.entityTypes, null, 2)}
</ENTITY_TYPES>

<ENTITIES>
${JSON.stringify(context.entities, null, 2)}
</ENTITIES>

<EPISODE_CONTENT>
${context.episodeContent}
</EPISODE_CONTENT>

Based on the above information, please extract and enhance attributes for each entity according to its type definition. Return only the uuid and updated attributes for each entity.`;
  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
