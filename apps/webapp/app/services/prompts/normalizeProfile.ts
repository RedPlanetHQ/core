import {
  OLLAMA_NUM_CTX,
  capToTokenBudget,
  assertPromptWithinBudget,
} from "~/services/prompts/promptBudget";
import { countTokens } from "~/services/search/tokenBudget";

export type PromptProfile = "hosted" | "ollama";

export type ConversationSectionId =
  | "preamble"
  | "speaker_role_awareness"
  | "enrichment_strategy"
  | "temporal_resolution"
  | "visual_content_capture"
  | "strategic_enrichment"
  | "entity_types"
  | "ingestion_rules"
  | "quality_control"
  | "enrichment_examples"
  | "output_format";

/**
 * Budget arithmetic and design rationale.
 *
 * OLLAMA_NUM_CTX is frozen at 4096 because 8192 evicted qwen3:8b from an
 * RTX 4060's 8GB VRAM entirely (5.5GB -> 0GB), forcing CPU inference.
 * NORMALIZE_OUTPUT_TOKEN_RESERVE is 768 rather than OLLAMA_NUM_PREDICT_DEFAULT
 * (512) because normalization emits enriched prose, and 512 is too tight for
 * document-sized output.
 *
 * NORMALIZE_PROMPT_TOKEN_BUDGET = min(3300, 4096 - 768) = 3300. The raw ceiling
 * is 3328; the 3300 cap keeps a deliberate margin.
 *
 * Measured with the o200k_base tokenizer (not estimated):
 *   conversation system prompt ........ 5090 tokens
 *   document system prompt ............ 818 plain / 1172 SEMANTIC DIFF MODE
 *   document static minus dynamics ..... 761 plain / 1115 diff
 *
 * Document diff mode is the binding worst case, because it carries both the
 * larger static prompt AND previousVersionContent.
 *
 * The first draft of these allocations was wrong in the dangerous direction,
 * exactly as the rerank budgets were: the arithmetic predicted
 *   1115 static + 60 entityTypes + 180 ingestionRules + 60 glue
 *   + 900 episodeContent + 380 previousVersion + 260 sessionContext
 *   + 280 relatedMemories = 3235
 * but the measured worst case was 3307, which THREW against the 3300 budget.
 * The per-injection allocations below were reduced until the measured figure
 * cleared the budget with real margin. The lesson is the reason the assertion
 * exists: hand arithmetic under-counts formatting and tag overhead, so the
 * worst case is pinned by test in normalizeProfile.test.ts, never assumed.
 *
 * 3300 budget + 768 output = 4068 < 4096.
 *
 * ingestionRules is user-configurable text loaded from the database and was
 * entirely unbounded, so it is capped here alongside the retrieval injections.
 *
 * The conversation system prompt is 5090 tokens, so it does not fit a 4096
 * window even with zero injected content. Section dropping is the only
 * mechanism that can make it fit, and it is lossy. Conversation normalization
 * therefore stays on a hosted provider today; the ollama profile is a correct,
 * tested mechanism rather than a live routing decision.
 *
 * "hosted" is the DEFAULT and applies zero caps and zero section dropping. A
 * golden-file snapshot test proves hosted output is byte-identical to the
 * original template, including for deliberately oversized fixtures, so any
 * unconditional capping is a regression.
 */
export const NORMALIZE_OUTPUT_TOKEN_RESERVE = 768;
export const NORMALIZE_PROMPT_TOKEN_BUDGET = Math.min(
  3300,
  OLLAMA_NUM_CTX - NORMALIZE_OUTPUT_TOKEN_RESERVE,
);

export const NORMALIZE_EPISODE_CONTENT_TOKEN_BUDGET = 860;
export const NORMALIZE_PREVIOUS_VERSION_TOKEN_BUDGET = 380;
export const NORMALIZE_SESSION_CONTEXT_TOKEN_BUDGET = 240;
export const NORMALIZE_RELATED_MEMORIES_TOKEN_BUDGET = 260;
export const NORMALIZE_INGESTION_RULES_TOKEN_BUDGET = 180;
export const NORMALIZE_ENTITY_TYPES_TOKEN_BUDGET = 60;

export const CANONICAL_SECTION_ORDER: ConversationSectionId[] = [
  "preamble",
  "speaker_role_awareness",
  "enrichment_strategy",
  "temporal_resolution",
  "visual_content_capture",
  "strategic_enrichment",
  "entity_types",
  "ingestion_rules",
  "quality_control",
  "enrichment_examples",
  "output_format",
];

/**
 * Drop order for the ollama profile, cheapest loss first. enrichment_examples
 * leads because it is 1626 tokens, roughly a third of the whole template.
 *
 * preamble, entity_types, ingestion_rules and output_format are absent by
 * design: they are undroppable. The <output> tags in output_format are
 * load-bearing, and dropping them breaks response parsing downstream.
 */
export const SECTION_DROP_PRIORITY: ConversationSectionId[] = [
  "enrichment_examples",
  "strategic_enrichment",
  "speaker_role_awareness",
  "enrichment_strategy",
  "quality_control",
  "temporal_resolution",
  "visual_content_capture",
];

export function resolveProfile(providerType: string): PromptProfile {
  return providerType === "ollama" ? "ollama" : "hosted";
}

/**
 * Bound every variable-length injection for the ollama profile.
 *
 * Returns the context untouched on hosted providers: the golden-file test
 * depends on hosted output being byte-identical, so capping must never be
 * unconditional.
 *
 * Absent values stay absent. Several of these drive `||` fallbacks and
 * ternaries in the prompt templates, so turning `undefined` into `""` would
 * silently change which branch renders.
 */
export function capNormalizeContext(
  context: Record<string, any>,
  profile: PromptProfile,
): Record<string, any> {
  if (profile === "hosted") {
    return context;
  }

  const capped = { ...context };

  const budgets: Array<[string, number]> = [
    ["episodeContent", NORMALIZE_EPISODE_CONTENT_TOKEN_BUDGET],
    ["sessionContext", NORMALIZE_SESSION_CONTEXT_TOKEN_BUDGET],
    ["relatedMemories", NORMALIZE_RELATED_MEMORIES_TOKEN_BUDGET],
    ["previousVersionContent", NORMALIZE_PREVIOUS_VERSION_TOKEN_BUDGET],
    ["ingestionRules", NORMALIZE_INGESTION_RULES_TOKEN_BUDGET],
    ["entityTypes", NORMALIZE_ENTITY_TYPES_TOKEN_BUDGET],
  ];

  for (const [key, budget] of budgets) {
    const value = capped[key];
    if (typeof value === "string" && value.length > 0) {
      capped[key] = capToTokenBudget(value, budget);
    }
  }

  return capped;
}

/**
 * Join the selected sections in canonical order, separated by a blank line.
 * Selection order is ignored on purpose: canonical order is the contract.
 */
export function assembleSections(
  sections: Record<ConversationSectionId, string>,
  selected: ConversationSectionId[],
): string {
  const selectedSet = new Set(selected);
  return CANONICAL_SECTION_ORDER.filter((id) => selectedSet.has(id))
    .map((id) => sections[id])
    .join("\n\n");
}

/**
 * Choose which sections to render.
 *
 * Hosted returns the full canonical order unconditionally. Ollama drops in
 * SECTION_DROP_PRIORITY order and stops as soon as the prompt fits, so it never
 * degrades the prompt more than the budget requires.
 *
 * `fixedTokens` is everything outside the section list that still consumes the
 * same window (the user prompt, and the output reserve if the caller accounts
 * for it), so the fit test reflects the real request rather than the system
 * prompt alone.
 */
export function selectSections(
  sections: Record<ConversationSectionId, string>,
  profile: PromptProfile,
  opts: { fixedTokens: number; budget?: number },
): ConversationSectionId[] {
  if (profile === "hosted") {
    return [...CANONICAL_SECTION_ORDER];
  }

  const budget = opts.budget ?? NORMALIZE_PROMPT_TOKEN_BUDGET;
  const selected = [...CANONICAL_SECTION_ORDER];

  const totalTokens = (): number =>
    opts.fixedTokens + countTokens(assembleSections(sections, selected));

  for (const id of SECTION_DROP_PRIORITY) {
    if (totalTokens() <= budget) {
      break;
    }

    const index = selected.indexOf(id);
    if (index === -1) {
      continue;
    }

    selected.splice(index, 1);
  }

  // Everything droppable is gone and it still does not fit. Fail loudly rather
  // than hand Ollama a prompt it will silently truncate.
  //
  // The assertion budget is net of fixedTokens because assertPromptWithinBudget
  // only measures the text it is given; comparing the sections alone against the
  // full budget would let an over-budget request pass silently.
  assertPromptWithinBudget({
    label: "normalize conversation system prompt (ollama profile)",
    text: assembleSections(sections, selected),
    budget: Math.max(0, budget - opts.fixedTokens),
  });

  return selected;
}
