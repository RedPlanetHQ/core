import { EntityTypes } from "@core/types";

/**
 * Shared fixtures for the normalize golden-file tests.
 *
 * These exist so the composed-template refactor can be proven byte-identical to
 * the pre-refactor static templates. The snapshots in `__snapshots__/` were
 * generated from the ORIGINAL normalizePrompt/normalizeDocumentPrompt before any
 * section extraction, so they are the frozen definition of "Gemini's behaviour
 * does not change".
 */

export const FIXTURE_ENTITY_TYPES = EntityTypes.filter((t) => t !== "Predicate")
  .map((t) => `- ${t}`)
  .join("\n");

/** Deliberately larger than any Ollama-profile cap, so the Gemini profile is proven not to truncate. */
export const FIXTURE_LONG_CONTENT = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(400);

const BASE = {
  entityTypes: FIXTURE_ENTITY_TYPES,
  source: "claude",
  episodeTimestamp: "2026-08-06T12:00:00.000Z",
};

export const NORMALIZE_FIXTURES: Record<string, Record<string, any>> = {
  "conversation-full": {
    ...BASE,
    episodeContent: "user: I prefer dark mode\nassistant: Noted. Want me to change it?",
    relatedMemories: "Jane uses CORE daily.\nJane prefers keyboard shortcuts.",
    ingestionRules: "Only store facts the user states directly.",
    sessionContext: "Episode 1 (2026-08-06T11:00:00.000Z): Jane asked about themes.",
    userName: "Jane",
  },
  "conversation-minimal": {
    ...BASE,
    episodeContent: "Nothing much happened.",
    relatedMemories: "",
    ingestionRules: undefined,
    sessionContext: undefined,
    userName: undefined,
  },
  "conversation-oversized": {
    ...BASE,
    episodeContent: FIXTURE_LONG_CONTENT,
    relatedMemories: FIXTURE_LONG_CONTENT,
    ingestionRules: FIXTURE_LONG_CONTENT,
    sessionContext: FIXTURE_LONG_CONTENT,
    userName: "Jane",
  },
};

export const NORMALIZE_DOCUMENT_FIXTURES: Record<string, Record<string, any>> = {
  "document-plain": {
    ...BASE,
    episodeContent: "The API returns 200 on success.",
    relatedMemories: "The service is written in TypeScript.",
    ingestionRules: undefined,
    sessionContext: "Chunk 0 (2026-08-06T11:00:00.000Z): Introduction section.",
    previousVersionContent: undefined,
  },
  "document-diff": {
    ...BASE,
    episodeContent: "[+] Added pagination\n[-] Removed OAuth 1.0",
    relatedMemories: "The API is versioned.",
    ingestionRules: "Ignore changelog boilerplate.",
    sessionContext: "Chunk 0 (2026-08-06T11:00:00.000Z): Introduction section.",
    previousVersionContent: "[Chunk 0]\nThe API supports OAuth 1.0 and no pagination.",
  },
  "document-oversized": {
    ...BASE,
    episodeContent: FIXTURE_LONG_CONTENT,
    relatedMemories: FIXTURE_LONG_CONTENT,
    ingestionRules: FIXTURE_LONG_CONTENT,
    sessionContext: FIXTURE_LONG_CONTENT,
    previousVersionContent: FIXTURE_LONG_CONTENT,
  },
};
