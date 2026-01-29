export const SEARCH_CONTEXT = `
## 🔴 MANDATORY STARTUP SEQUENCE - DO NOT SKIP 🔴

**BEFORE RESPONDING TO ANY USER MESSAGE, YOU MUST EXECUTE THESE TOOLS IN ORDER:**

### STEP 1 (REQUIRED): Search for Relevant Context

EXECUTE THIS TOOL FIRST:
\`memory_search\`

- Previous discussions about the current topic
- Related project decisions and implementations
- User preferences and work patterns
- Similar problems and their solutions

**Additional search triggers:**

- User mentions "previously", "before", "last time", or "we discussed"
- User references past work or project history
- Working on the CORE project (this repository)
- User asks about preferences, patterns, or past decisions
- Starting work on any feature or bug that might have history

**How to search effectively:**

- Write complete semantic queries, NOT keyword fragments
- Good: \`"Manoj's preferences for API design and error handling"\`
- Bad: \`"manoj api preferences"\`
- Ask: "What context am I missing that would help?"
- Consider: "What has the user told me before that I should remember?"

### Query Patterns for Memory Search

**Entity-Centric Queries** (Best for graph search):

- ✅ GOOD: \`"Manoj's preferences for product positioning and messaging"\`
- ✅ GOOD: \`"CORE project authentication implementation decisions"\`
- ❌ BAD: \`"manoj product positioning"\`
- Format: \`[Person/Project] + [relationship/attribute] + [context]\`

**Multi-Entity Relationship Queries** (Excellent for episode graph):

- ✅ GOOD: \`"Manoj and Harshith discussions about BFS search implementation"\`
- ✅ GOOD: \`"relationship between entity extraction and recall quality in CORE"\`
- ❌ BAD: \`"manoj harshith bfs"\`
- Format: \`[Entity1] + [relationship type] + [Entity2] + [context]\`

**Semantic Question Queries** (Good for vector search):

- ✅ GOOD: \`"What causes BFS search to return empty results? What are the requirements for BFS traversal?"\`
- ✅ GOOD: \`"How does episode graph search improve recall quality compared to traditional search?"\`
- ❌ BAD: \`"bfs empty results"\`
- Format: Complete natural questions with full context

**Concept Exploration Queries** (Good for BFS traversal):

- ✅ GOOD: \`"concepts and ideas related to semantic relevance in knowledge graph search"\`
- ✅ GOOD: \`"topics connected to hop distance weighting and graph topology in BFS"\`
- ❌ BAD: \`"semantic relevance concepts"\`
- Format: \`[concept] + related/connected + [domain/context]\`

**Temporal Queries** (Good for recent work):

- ✅ GOOD: \`"recent changes to search implementation and reranking logic"\`
- ✅ GOOD: \`"latest discussions about entity extraction and semantic relevance"\`
- ❌ BAD: \`"recent search changes"\`
- Format: \`[temporal marker] + [specific topic] + [additional context]\`

## 🔴 MANDATORY SHUTDOWN SEQUENCE - DO NOT SKIP 🔴

**AFTER FULLY RESPONDING TO THE USER, YOU MUST EXECUTE THIS TOOL:**
`;
