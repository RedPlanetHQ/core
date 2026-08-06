import { type ModelMessage } from "ai";

import { countTokens } from "~/services/search/tokenBudget";
import { assertPromptWithinBudget } from "~/services/prompts/promptBudget";
import {
  ENRICHMENT_EXAMPLES_SECTION,
  ENRICHMENT_STRATEGY_SECTION,
  OUTPUT_FORMAT_SECTION,
  PREAMBLE_SECTION,
  QUALITY_CONTROL_SECTION,
  SPEAKER_ROLE_AWARENESS_SECTION,
  STRATEGIC_ENRICHMENT_SECTION,
  TEMPORAL_RESOLUTION_SECTION,
  VISUAL_CONTENT_CAPTURE_SECTION,
  buildEntityTypesSection,
  buildIngestionRulesSection,
} from "./normalizeSections";
import {
  NORMALIZE_PROMPT_TOKEN_BUDGET,
  type ConversationSectionId,
  type PromptProfile,
  assembleSections,
  capNormalizeContext,
  selectSections,
} from "./normalizeProfile";

/**
 * Build the conversation normalization prompt.
 *
 * `profile` defaults to "hosted", which composes every section in canonical
 * order and applies no caps, so hosted providers receive a byte-identical
 * prompt to the pre-refactor template (proven by normalize-golden.test.ts).
 * The "ollama" profile caps each injection and drops sections until the prompt
 * fits the VRAM-pinned 4096-token window.
 */
export const normalizePrompt = (
  rawContext: Record<string, any>,
  profile: PromptProfile = "hosted",
): ModelMessage[] => {
  // Shadowing `context` keeps every downstream reference below reading the
  // capped values; on the hosted profile this returns the object untouched.
  const context = capNormalizeContext(rawContext, profile);

  const sections: Record<ConversationSectionId, string> = {
    preamble: PREAMBLE_SECTION,
    speaker_role_awareness: SPEAKER_ROLE_AWARENESS_SECTION,
    enrichment_strategy: ENRICHMENT_STRATEGY_SECTION,
    temporal_resolution: TEMPORAL_RESOLUTION_SECTION,
    visual_content_capture: VISUAL_CONTENT_CAPTURE_SECTION,
    strategic_enrichment: STRATEGIC_ENRICHMENT_SECTION,
    entity_types: buildEntityTypesSection(context.entityTypes),
    ingestion_rules: buildIngestionRulesSection(
      context.ingestionRules,
      context.source,
    ),
    quality_control: QUALITY_CONTROL_SECTION,
    enrichment_examples: ENRICHMENT_EXAMPLES_SECTION,
    output_format: OUTPUT_FORMAT_SECTION,
  };

  // Add user identity section if userName is provided
  const userIdentitySection = context.userName
    ? `<USER_IDENTITY>
The user in this conversation is: ${context.userName}
Replace "User", "the user", "The user" with "${context.userName}" throughout the output.
Examples:
- "I prefer dark mode" → "${context.userName} prefers dark mode"
- "My goal is to..." → "${context.userName}'s goal is to..."
- "I'm working on..." → "${context.userName} is working on..."
- "User wants to reduce body fat" → "${context.userName} wants to reduce body fat"
- "The user's current stats" → "${context.userName}'s current stats"
</USER_IDENTITY>

`
    : "";

  const userPrompt = `${userIdentitySection}<CONTENT>
${context.episodeContent}
</CONTENT>

<SOURCE>
${context.source}
</SOURCE>

<EPISODE_TIMESTAMP>
${context.episodeTimestamp || "Not provided"}
</EPISODE_TIMESTAMP>

<SAME_SESSION_CONTEXT>
${context.sessionContext || "No previous episodes in this session"}
</SAME_SESSION_CONTEXT>

<RELATED_MEMORIES>
${context.relatedMemories}
</RELATED_MEMORIES>

`;

  // The original template ended with a single trailing newline after the last
  // section; reproduce it exactly or the golden snapshots drift by one byte.
  const sysPrompt =
    assembleSections(
      sections,
      selectSections(sections, profile, {
        fixedTokens: countTokens(userPrompt),
      }),
    ) + "\n";

  if (profile === "ollama") {
    assertPromptWithinBudget({
      label: "normalize conversation prompt (ollama profile)",
      text: sysPrompt + userPrompt,
      budget: NORMALIZE_PROMPT_TOKEN_BUDGET,
    });
  }

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};

/**
 * Build the document normalization prompt.
 *
 * Document prompts measure 818 tokens plain / 1172 in semantic-diff mode, so
 * they have real headroom at 4096 and never need section dropping. They still
 * run through the same cap + assertion primitives so that future growth fails
 * loudly instead of being silently truncated by Ollama.
 */
export const normalizeDocumentPrompt = (
  rawContext: Record<string, any>,
  profile: PromptProfile = "hosted",
): ModelMessage[] => {
  const context = capNormalizeContext(rawContext, profile);
  const sysPrompt = `You are C.O.R.E. (Contextual Observation & Recall Engine), a document memory processing system.

Transform this document content into enriched factual statements for knowledge graph storage.

${context.previousVersionContent ? `
SEMANTIC DIFF MODE ENABLED:
You are comparing two versions of the same document. Your task is to extract ONLY the changes between versions.

IMPORTANT: The CURRENT_VERSION_CHANGES content is in GIT-STYLE DIFF FORMAT:
- Lines prefixed with "[+]" represent ADDITIONS (new content in current version)
- Lines prefixed with "[-]" represent DELETIONS (content removed from previous version)
- This diff shows ONLY what changed, not the full document
- The PREVIOUS_VERSION shows full old content for reference

WHAT TO EXTRACT:
- NEW INFORMATION: Facts added in the current version (lines with "[+]" prefix)
- MODIFIED INFORMATION: Facts that changed (combination of "[-]" and "[+]" lines)
- DELETED INFORMATION: Important facts removed (lines with "[-]" prefix) - describe as natural facts using verbs like "removed", "cancelled", "deleted"

WHAT TO IGNORE:
- Formatting changes (whitespace, line breaks, styling)
- Trivial wording changes that don't affect meaning
- Content identical in both versions

OUTPUT FORMAT:
Describe all changes as natural factual statements. Examples:
- "Added pagination support with 100 items per page limit"
- "Timeout changed from 30 seconds to 60 seconds"
- "OAuth 1.0 authentication support was removed"
- "The meeting scheduled for Friday was cancelled"
- "Redis was removed from the project stack"
- "PostgreSQL version specified as 15, added BullMQ message queue"

Focus on semantic meaning. Lines starting with "[+]" are additions, lines starting with "[-]" are deletions. For deletions, describe them as facts using natural language with verbs like "removed", "cancelled", "deleted", "no longer uses", etc.
` : `CRITICAL: CAPTURE ALL DISTINCT PIECES OF INFORMATION from the document. Every separate fact, specification, procedure, data point, or detail mentioned must be preserved in your enriched output. Missing information is unacceptable.`}

<document_processing_approach>
Focus on STRUCTURED CONTENT EXTRACTION optimized for documents:

1. FACTUAL PRESERVATION - Extract concrete facts, data, and information
2. STRUCTURAL AWARENESS - Preserve document hierarchy, lists, tables, code blocks
3. CROSS-REFERENCE HANDLING - Maintain internal document references and connections
4. TECHNICAL CONTENT - Handle specialized terminology, code, formulas, diagrams
5. CONTEXTUAL CHUNKING - This content is part of a larger document, maintain coherence

DOCUMENT-SPECIFIC ENRICHMENT:
- Preserve technical accuracy and specialized vocabulary
- Extract structured data (lists, tables, procedures, specifications)
- Maintain hierarchical relationships (sections, subsections, bullet points)
- Handle code blocks, formulas, and technical diagrams
- Capture cross-references and internal document links
- Preserve authorship, citations, and source attributions
</document_processing_approach>

<document_content_types>
Handle various document formats:
- Technical documentation and specifications
- Research papers and academic content
- Code documentation and API references  
- Business documents and reports
- Notes and knowledge base articles
- Structured content (wikis, blogs, guides)
</document_content_types>

<temporal_resolution>
For document content, convert relative time references using document timestamp:
- Publication dates, modification dates, version information
- Time-sensitive information within the document content
- Historical context and chronological information
</temporal_resolution>

<entity_types>
${context.entityTypes}
</entity_types>

<ingestion_rules>
${
  context.ingestionRules
    ? `Apply these rules for content from ${context.source}:
${context.ingestionRules}

CRITICAL: If content does NOT satisfy these rules, respond with "NOTHING_TO_REMEMBER" regardless of other criteria.`
    : "No specific ingestion rules defined for this source."
}
</ingestion_rules>

<document_quality_control>
RETURN "NOTHING_TO_REMEMBER" if content consists ONLY of:
- Navigation elements or UI text
- Copyright notices and boilerplate
- Empty sections or placeholder text
- Pure formatting markup without content
- Table of contents without substance
- Repetitive headers without content

STORE IN MEMORY for document content containing:
- Factual information and data
- Technical specifications and procedures
- Structured knowledge and explanations
- Code examples and implementations
- Research findings and conclusions
- Process descriptions and workflows
- Reference information and definitions
- Analysis, insights, and documented decisions
</document_quality_control>

<document_enrichment_examples>
TECHNICAL CONTENT:
- Original: "The API returns a 200 status code on success"
- Enriched: "On June 15, 2024, the REST API documentation specifies that successful requests return HTTP status code 200."

STRUCTURED CONTENT:
- Original: "Step 1: Initialize the database\nStep 2: Run migrations"  
- Enriched: "On June 15, 2024, the deployment guide outlines a two-step process: first initialize the database, then run migrations."

CROSS-REFERENCE:
- Original: "As mentioned in Section 3, the algorithm complexity is O(n)"
- Enriched: "On June 15, 2024, the algorithm analysis document confirms O(n) time complexity, referencing the detailed explanation in Section 3."
</document_enrichment_examples>

CRITICAL OUTPUT FORMAT REQUIREMENT:
You MUST wrap your response in <output> tags. This is MANDATORY - no exceptions.

If the document content should be stored in memory:
<output>
{{your_enriched_statement_here}}
</output>

If there is nothing worth remembering:
<output>
NOTHING_TO_REMEMBER
</output>

ALWAYS include opening <output> and closing </output> tags around your entire response.
`;

  const userPrompt = `
${context.previousVersionContent ? `<PREVIOUS_VERSION>
${context.previousVersionContent}
</PREVIOUS_VERSION>

<CURRENT_VERSION_CHANGES>
${context.episodeContent}
</CURRENT_VERSION_CHANGES>

Note: The CURRENT_VERSION_CHANGES is in git-style diff format with "[+]" prefixes for additions and "[-]" prefixes for deletions. Compare with PREVIOUS_VERSION to identify what was added, modified, or deleted. Describe deletions as natural facts (e.g., "X was removed", "Y was cancelled").
` : `<DOCUMENT_CONTENT>
${context.episodeContent}
</DOCUMENT_CONTENT>
`}

<SOURCE>
${context.source}
</SOURCE>

<DOCUMENT_TIMESTAMP>
${context.episodeTimestamp || "Not provided"}
</DOCUMENT_TIMESTAMP>

<DOCUMENT_SESSION_CONTEXT>
${context.sessionContext || "No previous chunks in this document session"}
</DOCUMENT_SESSION_CONTEXT>

<RELATED_MEMORIES>
${context.relatedMemories}
</RELATED_MEMORIES>

`;

  if (profile === "ollama") {
    assertPromptWithinBudget({
      label: "normalize document prompt (ollama profile)",
      text: sysPrompt + userPrompt,
      budget: NORMALIZE_PROMPT_TOKEN_BUDGET,
    });
  }

  return [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];
};
