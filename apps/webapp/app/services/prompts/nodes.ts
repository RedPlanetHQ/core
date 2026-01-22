/**
 * Prompts for extracting entity nodes from episodes
 */

import { ModelMessage } from "ai";
import z from "zod";


/**
 * Resolve entity duplications
 */
export const dedupeNodes = (context: Record<string, any>): ModelMessage[] => {
  return [
    {
      role: "system",
      content: `You are a helpful assistant who determines whether extracted entities are duplicates of existing entities.

Focus on name-based similarity, entity type, and contextual meaning to identify duplicates.

Each entity in ENTITIES is represented as a JSON object with the following structure:
{
    id: integer id of the entity,
    name: "name of the entity",
    type: "entity type (Person, Organization, Technology, etc.)",
    attributes: { optional attributes like email, phone, company },
    duplication_candidates: [
        {
            idx: integer index of the candidate entity,
            name: "name of the candidate entity",
            type: "entity type",
            attributes: { optional attributes }
        }
    ]
}

## Duplication Decision Framework

### MARK AS DUPLICATE (duplicate_idx >= 0) when:
- **IDENTICAL NAMES**: Exact same name or obvious synonyms
- **SEMANTIC EQUIVALENCE**: Different names but clearly referring to the same entity
- **STRUCTURAL VARIATIONS**: Same entity with minor formatting differences
- **SAME PERSON**: Same name with matching/complementary attributes (e.g., same email, same company)

### DO NOT mark as duplicate (duplicate_idx = -1) when:
- **DIFFERENT INSTANCES**: Similar names but different real-world entities
- **CONTEXTUAL DISTINCTION**: Same name but different contexts suggest distinct entities
- **HIERARCHICAL RELATIONSHIPS**: One is part of/contains the other
- **TYPE MISMATCH**: Same name but clearly different types (e.g., "Apple" as Person vs Organization)
- **CONFLICTING ATTRIBUTES**: Same name but different emails, different companies, etc.

## Example Patterns:

**DUPLICATE CASES:**
- "John Smith" (Person) vs "John Smith" (Person) → Check context, same person (duplicate_idx = 0)
- "Microsoft" (Organization) vs "Microsoft Corporation" (Organization) → Same org (duplicate_idx = 2)
- "Sarah" (Person, email: sarah@x.com) vs "Sarah" (Person, company: X Corp) → Likely same, merge attributes
- "iPhone" (Product) vs "Apple iPhone" (Product) → Same product (duplicate_idx = 1)

**NOT DUPLICATE CASES:**
- "Apple" (Person) vs "Apple" (Organization) → Different entities (duplicate_idx = -1)
- "John" (Person, email: john@a.com) vs "John" (Person, email: john@b.com) → Different people
- "Meeting Room A" vs "Meeting Room B" → Different rooms (duplicate_idx = -1)
- "Project Alpha" vs "Project Beta" → Different projects (duplicate_idx = -1)

## Attribute Merging Notes:
When entities are marked as duplicates, their attributes will be merged automatically:
- Target entity's attributes take precedence for conflicts
- Source entity's attributes fill in missing fields
- Example: Source {email: "x@y.com"} + Target {phone: "123"} → Merged {email: "x@y.com", phone: "123"}

## Decision Guidelines:
- **CONSERVATIVE APPROACH**: When uncertain, prefer NOT marking as duplicate
- **CONTEXT MATTERS**: Consider the episode content and previous episodes
- **SEMANTIC MEANING**: Focus on whether they refer to the same real-world entity
- **TYPE AWARENESS**: Consider entity types - same name but different types usually means different entities
- **ATTRIBUTE AWARENESS**: Conflicting attributes (different emails for same name) suggest different entities

Format your response as follows:
<output>
{
  "entity_resolutions": [
    {
      "id": 1,
      "name": "Entity Name",
      "duplicate_idx": 2
    }
  ]
}
</output>

## CRITICAL OUTPUT FORMAT REQUIREMENTS:

**YOU MUST STRICTLY FOLLOW THESE FORMAT RULES:**
1. **ALWAYS use <output> tags** - Never use any other tag format
2. **ONLY output valid JSON** within the <output> tags
3. **NO additional text** before or after the <output> tags
4. **NO comments** inside the JSON
5. **REQUIRED structure:** Must follow exact JSON schema shown above

## Important Instructions:
- **ONLY include entities that ARE duplicates** (duplicate_idx >= 0)
- **OMIT all non-duplicate entities** - empty array if no duplicates found
- Always wrap the output in these tags <output> </output>
- When in doubt, prefer NOT marking as duplicate (omit from output)
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
