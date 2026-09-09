import { describe, expect, it } from "vitest";
import { normalizePrompt, normalizeDocumentPrompt } from "../normalize";
import {
  NORMALIZE_DOCUMENT_FIXTURES,
  NORMALIZE_FIXTURES,
} from "./normalize-fixtures";

/**
 * Golden-file proof that the composed-template refactor did not change a single
 * byte of what hosted providers (Gemini) receive.
 *
 * The snapshots in `__snapshots__/normalize-golden.test.ts/` were generated from
 * the ORIGINAL static templates, before normalizePrompt was decomposed into
 * named sections and an assembler. An assertion could only prove the prompt is
 * "small enough"; only a frozen byte-for-byte snapshot proves the assembler
 * still emits the exact same template. If anyone edits a section constant, the
 * assembler order, or a separator, this test fails loudly instead of silently
 * drifting the production prompt.
 *
 * Do NOT regenerate these snapshots to make a failure go away. A diff here means
 * the prompt sent to Gemini changed, which is a behavioural change that must be
 * intentional and reviewed.
 */

function render(messages: ReturnType<typeof normalizePrompt>): string {
  return messages
    .map((m) => `=== role: ${m.role} ===\n${m.content as string}`)
    .join("\n");
}

describe("normalize prompt golden files (default/Gemini profile)", () => {
  for (const [name, context] of Object.entries(NORMALIZE_FIXTURES)) {
    it(`normalizePrompt renders byte-identically for ${name}`, async () => {
      await expect(render(normalizePrompt(context))).toMatchFileSnapshot(
        `./__snapshots__/normalize-${name}.txt`,
      );
    });
  }

  for (const [name, context] of Object.entries(NORMALIZE_DOCUMENT_FIXTURES)) {
    it(`normalizeDocumentPrompt renders byte-identically for ${name}`, async () => {
      await expect(render(normalizeDocumentPrompt(context))).toMatchFileSnapshot(
        `./__snapshots__/normalize-${name}.txt`,
      );
    });
  }
});
