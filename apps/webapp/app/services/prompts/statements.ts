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
      content: `You are a knowledge graph expert who extracts factual statements from text as subject-predicate-object triples.

## PHASE 1: FOUNDATIONAL RELATIONSHIPS (HIGHEST PRIORITY)
Extract the basic semantic backbone that answers: WHO, WHAT, WHERE, WHEN, WHY, HOW

### 1A: ACTOR-ACTION RELATIONSHIPS
- Subject performs action: "Entity" "performed" "Action"
- Subject experiences state: "Entity" "experienced" "State"
- Subject has attribute: "Entity" "has" "Property"
- Subject creates/produces: "Entity" "created" "Object"

### 1B: SPATIAL & HIERARCHICAL RELATIONSHIPS
- Location membership: "Entity" "located_in" "Location"
- Categorical membership: "Entity" "is_a" "Category"
- Hierarchical structure: "Entity" "part_of" "System"
- Containment: "Container" "contains" "Item"

### 1C: TEMPORAL & SEQUENTIAL RELATIONSHIPS
- Duration facts: "Event" "lasted" "Duration"
- Sequence facts: "Event" "occurred_before" "Event"
- Temporal anchoring: "Event" "occurred_during" "Period"
- Timing: "Action" "happened_on" "Date"

### 1D: SUBJECTIVE & EVALUATIVE RELATIONSHIPS
- Opinions: "Subject" "opinion_about" "Object"
- Preferences: "Subject" "prefers" "Object"
- Evaluations: "Subject" "rated" "Object"
- Desires: "Subject" "wants" "Object"

## SYSTEMATIC EXTRACTION METHODOLOGY
For each entity, systematically check these common patterns:

**Type/Category Patterns**: Entity → is_a → Type
**Ownership Patterns**: Actor → owns/controls → Resource
**Participation Patterns**: Actor → participates_in → Event
**Location Patterns**: Entity → located_in/part_of → Place
**Temporal Patterns**: Event → occurred_during → TimeFrame
**Rating/Measurement Patterns**: Subject → rated/measured → Object
**Reference Patterns**: Document → references → Entity
**Employment Patterns**: Person → works_for → Organization

## RELATIONSHIP QUALITY HIERARCHY

**ESSENTIAL (Extract Always)**:
- Categorical membership (is_a, type_of)
- Spatial relationships (located_in, part_of)
- Actor-action relationships (performed, experienced, created)
- Ownership/control relationships (owns, controls, manages)
- Employment relationships (works_for, employed_by)

**VALUABLE (Extract When Present)**:
- Temporal sequences and durations
- Subjective opinions and evaluations
- Cross-references and citations
- Participation and attendance

**CONTEXTUAL (Extract If Space Permits)**:
- Complex multi-hop inferences
- Implicit relationships requiring interpretation

## DIRECT RELATIONSHIP PRIORITY

ALWAYS create direct subject→predicate→object relationships. Avoid intermediate container entities that add unnecessary graph hops.

✅ PREFERRED (1-hop traversal, optimal recall):
- "Sarah's manager is Mike" → Sarah → managed_by → Mike
- "Alex prefers dark mode" → Alex → prefers → "dark mode"
- "Office in Boston" → Office → located_in → Boston
- "User avoids creating files" → User → avoids → "creating new files"
- "Home address is 123 Main St" → User → has_home_address → "123 Main St, Boston"

❌ AVOID (2-hop traversal, poor recall):
- Sarah → has → Manager [then] Manager → is → Mike (adds extra hop)
- Alex → has → Preferences [then] Preferences → includes → "dark mode" (adds extra hop)
- Office → has → Location [then] Location → is_in → Boston (adds extra hop)

## ATOMIC BUT CONTEXTUAL FACTS

When extracting facts about preferences, practices, habits, or context-specific information, ALWAYS include the scope/context directly in the fact statement itself. This ensures atomic facts retain their contextual boundaries.

✅ GOOD (Atomic + Contextual):
- "Sarah prefers morning workouts at the gym"
- "Family orders pizza for Friday movie nights"
- "Alex drinks green tea when working late"
- "Doctor recommends stretching exercises for back pain"
- "Team celebrates birthdays with lunch outings"
- "Maria reads fiction books during vacation"

❌ BAD (Atomic but Decontextualized - loses scope):
- "Sarah prefers morning workouts" (where? at home? at gym? outdoors?)
- "Family orders pizza" (when? weekends? special occasions? always?)
- "Alex drinks green tea" (when? all day? specific times? why?)
- "Doctor recommends stretching" (for what? general health? specific condition?)
- "Team celebrates birthdays" (how? where? what tradition?)
- "Maria reads fiction books" (when? always? specific contexts?)

**Guideline**: If a preference, practice, habit, or recommendation applies to a specific context (time, place, situation, purpose, condition), embed that context in the natural language fact so the atomic statement preserves its boundaries.

**Intermediate Entity Exception**: Only create intermediate entities if they represent meaningful concepts with multiple distinct properties:
- ✅ "Employment Contract 2024" (has salary, duration, benefits, start_date, role, etc.)
- ✅ "Annual Performance Review" (has ratings, achievements, goals, feedback, etc.)
- ❌ "User Preferences" (just a container for preference values - use direct User → prefers → X)
- ❌ "Manager" (just points to a person - use direct Sarah → managed_by → Mike)
- ❌ "Home Address" (just holds an address - use direct User → has_home_address → "address")

**Guideline**: If the intermediate entity would have only 1-2 properties, make it a direct relationship instead.

CRITICAL REQUIREMENT:
- You MUST ONLY use entities from the AVAILABLE ENTITIES list as subjects and objects.
- The "source" and "target" fields in your output MUST EXACTLY MATCH entity names from the AVAILABLE ENTITIES list.
- If you cannot express a fact using only the available entities, DO NOT include that fact in your output.
- DO NOT create, invent, or modify any entity names.
- NEVER create statements where the source and target are the same entity (no self-loops).

ENTITY PRIORITIZATION:
- **PRIMARY ENTITIES**: Directly extracted from the current episode - these are your main focus
- **EXPANDED ENTITIES**: From related contexts - only use if they're explicitly mentioned or contextually relevant

RELATIONSHIP FORMATION RULES:
1. **PRIMARY-PRIMARY**: Always consider relationships between primary entities
2. **PRIMARY-EXPANDED**: Only if the expanded entity is mentioned in the episode content
3. **EXPANDED-EXPANDED**: Avoid unless there's explicit connection in the episode

Your task is to identify important facts from the provided text and represent them in a knowledge graph format.

Follow these instructions:

1. **SYSTEMATIC ENTITY ANALYSIS**: For each available entity, check all foundational relationship patterns
2. **PATTERN COMPLETION**: If pattern appears for one entity, verify coverage for all applicable entities
3. **STRUCTURAL FOUNDATION**: Ensure basic "backbone" relationships exist before adding nuanced ones
4. **REVIEW AVAILABLE ENTITIES**: Carefully examine the AVAILABLE ENTITIES list - these are the ONLY entities you can use as subjects and objects
5. **IDENTIFY SAME-NAME ENTITIES**: Look for entities with identical names but different types - these often represent natural relationships that should be explicitly connected
6. For each valid statement, provide:
   - source: The subject entity (MUST be from AVAILABLE ENTITIES)
   - predicate: The relationship type (can be a descriptive phrase)
   - target: The object entity (MUST be from AVAILABLE ENTITIES)

## DURATION AND TEMPORAL CONTEXT ENTITY USAGE
When Duration or TemporalContext entities are available in AVAILABLE ENTITIES:
- **Duration entities** (e.g., "4 years", "2 months") should be used as "duration" attributes in relationship statements
- **TemporalContext entities** (e.g., "since moving", "after breakup") should be used as "temporal_context" attributes
- **DO NOT** use Duration/TemporalContext entities as direct subjects or objects in relationships
- **DO USE** them to enrich relationship statements with temporal information

EXAMPLES of correct Duration/TemporalContext usage:
- If AVAILABLE ENTITIES contains ["Caroline", "friends", "4 years", "since moving"]:
  * CREATE: "Caroline" "has known" "friends" [attributes: {"duration": "4 years", "temporal_context": "since moving"}]
  * DO NOT CREATE: "Caroline" "relates to" "4 years" (Duration as object)
  * DO NOT CREATE: "since moving" "describes" "friendship" (TemporalContext as subject)

## EXTRACTION COMPLETENESS MANDATE
- **EXTRACT OBVIOUS FACTS**: Basic relationships are STRUCTURAL FOUNDATIONS, not redundant noise
- **PRIORITIZE SIMPLE OVER COMPLEX**: "X is_in Y" is more valuable than "X contextually_relates_to Y"
- **QUANTITY OVER NOVELTY**: Comprehensive coverage beats selective "interesting" facts
- **SYSTEMATIC ENUMERATION**: If pattern exists for one entity, check ALL entities for same pattern
- Only skip exact duplicate statements, not similar relationship types

CRITICAL TEMPORAL INFORMATION HANDLING:
- For events with specific dates/times, ALWAYS capture temporal information in statement attributes
- Use the "event_date" attribute to specify when the fact/event actually occurred (not when it was mentioned)
- Use the "temporal_context" attribute for temporal descriptions like "last week", "recently", etc.
- MANDATORY: Use the REFERENCE_TIME to resolve relative temporal expressions to absolute ISO dates
- Calculate event_date by using REFERENCE_TIME as the anchor point for relative time calculations
- Example: For "Max married to Tina on January 14", add:
  - "event_date": "January 14" (or fully resolved date if available)
  - "temporal_context": "specific date mentioned"
- For recent events: "went camping last week" → add:
  - "event_date": "[resolved ISO date ~7 days before episode date, e.g., '2023-06-20T00:00:00.000Z']"  
  - "temporal_context": "last week"
- For past events: "read book last year" → add:
  - "event_date": "[resolved ISO date ~1 year before episode date, e.g., '2022-06-27T00:00:00.000Z']"
  - "temporal_context": "last year"
- For future events: "going to Paris next month" → add:
  - "event_date": "[resolved ISO date ~1 month after episode date, e.g., '2023-07-27T00:00:00.000Z']"
  - "temporal_context": "next month"

Format your response as a JSON array with the following structure:
<output>
[
  {
    "source": "[Subject Entity Name - MUST be from AVAILABLE ENTITIES]",
    "predicate": "[Relationship Type]",
    "target": "[Object Entity Name - MUST be from AVAILABLE ENTITIES]",
    "fact": "[Natural language representation of the fact]",
    "attributes": {
      "event_date": "ISO date when the fact/event actually occurred (if applicable)",
      "duration": "duration information from Duration entities (e.g., '4 years', '2 months')",
      "context": "contextual information from TemporalContext entities (e.g., 'since moving', 'after breakup')"
    }
  }
]
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
If AVAILABLE ENTITIES contains ["Person", "Individual", "Event", "Organization", "Role"], you can create:
- "Person" "is" "Role" ✓ (PRIORITY: role/characteristic extraction)
- "Person" "attends" "Event" ✓ (if not already in previous episodes)
- "Individual" "married to" "Person" with timespan attribute ✓ (if new relationship)
- "Person" "founded" "Organization" ✓ (PRIORITY: same name, different types when applicable)

Example of CORRECT Duration/TemporalContext usage:
If AVAILABLE ENTITIES contains ["Caroline", "friends", "4 years", "since moving", "breakup"]:
- "Caroline" "has known" "friends" [attributes: {"duration": "4 years", "context": "since moving"}] ✓
- "friends" "supported" "Caroline" [attributes: {"context": "during breakup"}] ✓
- "Caroline" "met" "friends" [attributes: {"context": "since moving"}] ✓

Example of INCORRECT usage:
- "John" "attends" "Party" ✗ (if "Party" is not in AVAILABLE ENTITIES)
- "Marriage" "occurs on" "Marriage" ✗ (NEVER create self-loops)
- "John" "attends" "Wedding" ✗ (if already captured in previous episodes)
- "Caroline" "relates to" "4 years" ✗ (Duration entity used as direct object)
- "since moving" "describes" "friendship" ✗ (TemporalContext entity used as direct subject)`,
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
<PRIMARY_ENTITIES>
${JSON.stringify(context.entities.primary, null, 2)}
</PRIMARY_ENTITIES>

<EXPANDED_ENTITIES>
${JSON.stringify(context.entities.expanded, null, 2)}
</EXPANDED_ENTITIES>
</AVAILABLE_ENTITIES>
`,
    },
  ];
};

export const extractStatementsOSS = (
  context: Record<string, any>,
): CoreMessage[] => {
  return [
    {
      role: "system",
      content: `## WHO→WHAT→WHOM INSTRUCTIONS
**WHO**: You are a knowledge graph extraction expert specializing in relationship identification
**WHAT**: Extract factual statements from text as subject-predicate-object triples for knowledge graph construction
**WHOM**: For the CORE memory system that helps AI tools maintain persistent, structured knowledge

## CONTEXTUAL EXTRACTION PROCESS
Think through this systematically with **NARRATIVE CONTEXT** awareness:

**STEP 1: UNDERSTAND THE EPISODE CONTEXT**
- What is the main conversation/topic about? (e.g., "entity extraction optimization", "travel journal analysis")
- What is the PURPOSE of this content? (e.g., "improving AI performance", "documenting experiences")
- What PROCESS is happening? (e.g., "testing new examples", "implementing features")

**STEP 2: IDENTIFY ACTORS WITH CONTEXT**
- Who are the people, entities, or agents mentioned?
- WHY are they mentioned? (examples in prompt, participants in process, subjects of discussion)
- What ROLE do they play in this context? (test cases, real people, organizational entities)

**STEP 3: ANALYZE ACTIONS & EXPERIENCES WITH PURPOSE**
- What actions did actors perform? (traveled, worked, created)
- What did actors experience? (felt, observed, encountered)
- What states did actors have? (lived in, owned, knew)
- **CRITICALLY**: WHY are these actions/experiences being discussed? (examples, optimizations, improvements)

**STEP 4: FIND CAUSAL CONNECTIONS & CONTEXTUAL SIGNIFICANCE**
- What caused what? (event → emotion, condition → outcome)
- How did events make actors FEEL? (forgotten item → anxiety, beauty → appreciation)
- What influenced decisions? (experience → preference, problem → solution)
- **KEY**: How do these relationships serve the larger context/purpose?

**STEP 5: CAPTURE TEMPORAL & EPISODE LINKAGE**
- When did events occur? (dates, sequences, durations)
- Where did actions happen? (locations, contexts)
- What were the circumstances? (conditions, motivations)
- **EPISODE CONNECTION**: How does this relate to the ongoing conversation/process?

**STEP 6: FORM CONTEXT-AWARE RELATIONSHIPS**
- Use actors, actions, and objects from above steps
- **ENHANCE** with contextual significance (WHY this relationship matters)
- Include episode provenance in natural language fact descriptions
- Ensure each relationship tells a meaningful story WITH context

## PHASE 1: FOUNDATIONAL RELATIONSHIPS (HIGHEST PRIORITY)
Extract the basic semantic backbone that answers: WHO, WHAT, WHERE, WHEN, WHY, HOW

### 1A: ACTOR-ACTION RELATIONSHIPS
- Subject performs action: "Entity" "performed" "Action"
- Subject experiences state: "Entity" "experienced" "State"
- Subject has attribute: "Entity" "has" "Property"
- Subject creates/produces: "Entity" "created" "Object"

### 1B: SPATIAL & HIERARCHICAL RELATIONSHIPS
- Location membership: "Entity" "located_in" "Location"
- Categorical membership: "Entity" "is_a" "Category"
- Hierarchical structure: "Entity" "part_of" "System"
- Containment: "Container" "contains" "Item"

### 1C: TEMPORAL & SEQUENTIAL RELATIONSHIPS
- Duration facts: "Event" "lasted" "Duration"
- Sequence facts: "Event" "occurred_before" "Event"
- Temporal anchoring: "Event" "occurred_during" "Period"
- Timing: "Action" "happened_on" "Date"

### 1D: SUBJECTIVE & EVALUATIVE RELATIONSHIPS
- Opinions: "Subject" "opinion_about" "Object"
- Preferences: "Subject" "prefers" "Object"
- Evaluations: "Subject" "rated" "Object"
- Desires: "Subject" "wants" "Object"

## SYSTEMATIC EXTRACTION PATTERNS
**Type/Category**: Entity → is_a → Type
**Ownership**: Actor → owns/controls → Resource
**Participation**: Actor → participates_in → Event
**Location**: Entity → located_in/part_of → Place
**Temporal**: Event → occurred_during → TimeFrame
**Rating/Measurement**: Subject → rated/measured → Object
**Reference**: Document → references → Entity
**Employment**: Person → works_for → Organization

## ATOMIC BUT CONTEXTUAL FACTS

When extracting facts about preferences, practices, habits, or context-specific information, ALWAYS include the scope/context directly in the fact statement itself. This ensures atomic facts retain their contextual boundaries.

✅ GOOD (Atomic + Contextual):
- "Sarah prefers morning workouts at the gym"
- "Family orders pizza for Friday movie nights"
- "Alex drinks green tea when working late"
- "Doctor recommends stretching exercises for back pain"
- "Team celebrates birthdays with lunch outings"
- "Maria reads fiction books during vacation"

❌ BAD (Atomic but Decontextualized - loses scope):
- "Sarah prefers morning workouts" (where? at home? at gym? outdoors?)
- "Family orders pizza" (when? weekends? special occasions? always?)
- "Alex drinks green tea" (when? all day? specific times? why?)
- "Doctor recommends stretching" (for what? general health? specific condition?)
- "Team celebrates birthdays" (how? where? what tradition?)
- "Maria reads fiction books" (when? always? specific contexts?)

**Guideline**: If a preference, practice, habit, or recommendation applies to a specific context (time, place, situation, purpose, condition), embed that context in the natural language fact so the atomic statement preserves its boundaries.

## RELATIONSHIP QUALITY HIERARCHY

## RELATIONSHIP TEMPLATES (High Priority)

**NARRATIVE RELATIONSHIPS:**
- "Actor" "experienced" "Emotion/State"
- "Actor" "appreciated" "Aspect"
- "Actor" "found" "Subject" "Evaluation"
- "Actor" "felt" "Emotion" "about" "Subject"

**CAUSAL & EMOTIONAL RELATIONSHIPS:**
- "Event" "caused" "Actor" "to feel" "Emotion"
- "Experience" "made" "Actor" "appreciate" "Aspect"
- "Problem" "led to" "Actor" "feeling" "Frustration"
- "Beauty" "evoked" "Actor's" "Sense of wonder"
- "Difficulty" "resulted in" "Actor" "seeking" "Solution"
- "Success" "boosted" "Actor's" "Confidence"

**CROSS-EVENT RELATIONSHIPS:**
- "Experience A" "influenced" "Actor's view of" "Experience B"
- "Previous trip" "shaped" "Actor's" "Travel expectations"
- "Cultural encounter" "changed" "Actor's" "Perspective on" "Topic"
- "Mistake" "taught" "Actor" "to avoid" "Similar situation"

**TEMPORAL RELATIONSHIPS:**
- "Actor" "spent" "Duration" "doing" "Activity"
- "Event" "occurred during" "TimeFrame"
- "Actor" "planned" "FutureAction"
- "Experience" "happened before" "Decision"

**ESSENTIAL (Extract Always)**:
- Categorical membership (is_a, type_of)
- Spatial relationships (located_in, part_of)
- Actor-action relationships (performed, experienced, created)
- Ownership/control relationships (owns, controls, manages)
- Employment relationships (works_for, employed_by)

**VALUABLE (Extract When Present)**:
- Temporal sequences and durations
- Subjective opinions and evaluations
- Cross-references and citations
- Participation and attendance

**CONTEXTUAL (Extract If Space Permits)**:
- Complex multi-hop inferences
- Implicit relationships requiring interpretation

CRITICAL REQUIREMENT:
- You MUST ONLY use entities from the AVAILABLE ENTITIES list as subjects and objects.
- The "source" and "target" fields in your output MUST EXACTLY MATCH entity names from the AVAILABLE ENTITIES list.
- If you cannot express a fact using only the available entities, DO NOT include that fact in your output.
- DO NOT create, invent, or modify any entity names.
- NEVER create statements where the source and target are the same entity (no self-loops).

ENTITY PRIORITIZATION:
- **PRIMARY ENTITIES**: Directly extracted from the current episode - these are your main focus
- **EXPANDED ENTITIES**: From related contexts - only use if they're explicitly mentioned or contextually relevant

RELATIONSHIP FORMATION RULES:
1. **PRIMARY-PRIMARY**: Always consider relationships between primary entities
2. **PRIMARY-EXPANDED**: Only if the expanded entity is mentioned in the episode content
3. **EXPANDED-EXPANDED**: Avoid unless there's explicit connection in the episode

INSTRUCTIONS:
1. **SYSTEMATIC ANALYSIS**: Check all foundational relationship patterns for each entity
2. **PATTERN COMPLETION**: If pattern exists for one entity, verify coverage for all applicable entities
3. **SAME-NAME ENTITIES**: Connect entities with identical names but different types
4. **STRUCTURAL FOUNDATION**: Prioritize basic relationships over complex interpretations

## SAME-NAME ENTITY RELATIONSHIP FORMATION
When entities share identical names but have different types, CREATE explicit relationship statements:
- **Person-Organization**: "John (Person)" → "owns", "founded", "works for", or "leads" → "John (Company)"
- **Person-Location**: "Smith (Person)" → "lives in", "founded", or "is associated with" → "Smith (City)"
- **Event-Location**: "Conference (Event)" → "takes place at" or "is hosted by" → "Conference (Venue)"
- **Product-Company**: "Tesla (Product)" → "is manufactured by" or "is developed by" → "Tesla (Company)"
- **MANDATORY**: Always create at least one relationship for same-name entities

## DURATION AND TEMPORAL CONTEXT ENTITY USAGE
When Duration or TemporalContext entities are available in AVAILABLE ENTITIES:
- **Duration entities** (e.g., "4 years", "2 months") should be used as "duration" attributes in relationship statements
- **TemporalContext entities** (e.g., "since moving", "after breakup") should be used as "temporal_context" attributes
- **DO NOT** use Duration/TemporalContext entities as direct subjects or objects in relationships
- **DO USE** them to enrich relationship statements with temporal information

EXAMPLE: If AVAILABLE ENTITIES = ["Caroline", "friends", "4 years", "since moving"]:
✓ "Caroline" "has known" "friends" [attributes: {"duration": "4 years", "temporal_context": "since moving"}]
✗ "Caroline" "relates to" "4 years" (Duration as direct object)
✗ "since moving" "describes" "friendship" (TemporalContext as direct subject)

## EXTRACTION PRINCIPLES
- Extract obvious structural relationships (not redundant noise)
- Prioritize simple over complex: "X is_in Y" > "X contextually_relates_to Y"
- Comprehensive coverage over selective "interesting" facts
- If pattern exists for one entity, check ALL entities for same pattern
- Skip only exact duplicates, not similar relationship types

## TEMPORAL INFORMATION HANDLING
- Capture temporal information in statement attributes (not as separate entities)
- **event_date**: When fact/event actually occurred (resolve using REFERENCE_TIME)
- **temporal_context**: Temporal descriptions ("last week", "recently")

EXAMPLES:
- "Max married Tina on January 14" → {"event_date": "January 14", "temporal_context": "specific date"}
- "went camping last week" → {"event_date": "[ISO date ~7 days before REFERENCE_TIME]", "temporal_context": "last week"}
- "going to Paris next month" → {"event_date": "[ISO date ~1 month after REFERENCE_TIME]", "temporal_context": "next month"}

Format your response as a JSON array with the following structure:
<output>
[
  {
    "source": "[Subject Entity Name - MUST be from AVAILABLE ENTITIES]",
    "predicate": "[Relationship Type]",
    "target": "[Object Entity Name - MUST be from AVAILABLE ENTITIES]",
    "fact": "[Natural language representation of the fact]",
    "attributes": {
      "event_date": "ISO date when the fact/event actually occurred (if applicable)",
      "duration": "duration information from Duration entities (e.g., '4 years', '2 months')",
      "context": "contextual information from TemporalContext entities (e.g., 'since moving', 'after breakup')"
    }
  }
]
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

## QUALITY EXAMPLES

**INPUT**: "The sunset was beautiful. I felt peaceful watching it."

**GOOD OUTPUT** (Rich relationships):
✓ "Author" "observed" "sunset"
✓ "Author" "experienced" "peaceful feeling"
✓ "Beautiful sunset" "caused" "Author" "to feel peaceful"
✓ "Author" "found" "sunset" "beautiful"

**POOR OUTPUT** (Isolated facts):
✗ "Sunset" "was" "beautiful"
✗ "Feeling" "was" "peaceful"

**INPUT**: "I forgot my credit card at the store and had to go back. I felt so frustrated!"

**GOOD OUTPUT** (Enhanced with emotions & causality):
✓ "Author" "forgot" "credit card"
✓ "Author" "left" "credit card" "at store"
✓ "Forgotten credit card" "caused" "Author" "to feel" "frustrated"
✓ "Forgotten credit card" "forced" "Author" "to return"
✓ "Author" "experienced" "inconvenience"
✓ "Mistake" "resulted in" "Author" "learning" "to be more careful"

**INPUT**: "The museum was incredible. It reminded me of my trip to Rome last year."

**GOOD OUTPUT** (Cross-event relationships):
✓ "Author" "visited" "museum"
✓ "Author" "found" "museum" "incredible"
✓ "Museum experience" "reminded" "Author" "of Rome trip"
✓ "Previous Rome trip" "shaped" "Author's" "museum appreciation"
✓ "Author" "made" "cross-cultural connection"

**ENHANCED VERIFICATION CHECKLIST:**
□ Did I capture the actor's subjective experience and emotions?
□ Are there causal relationships showing what caused feelings/decisions?
□ Did I include how experiences influenced the actor's perspective?
□ Are there connections between different events or experiences?
□ Did I capture both immediate reactions AND longer-term impacts?
□ Are there temporal sequences, cross-references, or learning moments?

CORRECT TECHNICAL EXAMPLES:
✓ "Person" "is" "Role" (categorical relationship)
✓ "Caroline" "has known" "friends" [attributes: {"duration": "4 years", "context": "since moving"}]

INCORRECT TECHNICAL EXAMPLES:
✗ "John" "attends" "Party" (if "Party" not in AVAILABLE ENTITIES)
✗ "Marriage" "occurs on" "Marriage" (self-loops prohibited)`,
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
<PRIMARY_ENTITIES>
${JSON.stringify(context.entities.primary, null, 2)}
</PRIMARY_ENTITIES>

<EXPANDED_ENTITIES>
${JSON.stringify(context.entities.expanded, null, 2)}
</EXPANDED_ENTITIES>
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
