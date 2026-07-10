/**
 * Live eval for the voice classifier prompt — 100+ held-out cases.
 *
 * NOT a mocked unit test. Calls the real Anthropic API with the current exported
 * `classifyVoicePrompt` and asserts on the model's output. Cases live in
 * `classify-voice.cases.json` and are pulled from real production CSV rows that
 * do NOT lexically overlap with the prompt (so passes aren't just copy-from-example).
 *
 * Runs only when `ANTHROPIC_API_KEY` is set. Skipped otherwise.
 *
 * Usage:
 *   cd apps/webapp
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm vitest run \
 *     app/services/prompts/__tests__/classify-voice.eval.test.ts
 *
 * Optional env:
 *   EVAL_MODEL — override the model (default claude-sonnet-4-6)
 *   EVAL_BATCH_SIZE — max facts per API call (default 30)
 *
 * Regenerating cases:
 *   The JSON file is produced offline by mining the production CSV. To refresh
 *   after prompt edits, re-run the case-generation script (see git log for the
 *   Python snippet that produced classify-voice.cases.json).
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { beforeAll, describe, test, expect } from "vitest";
import { classifyVoicePrompt, ClassifyVoiceSchema } from "../classify-voice";
import CASES_RAW from "./classify-voice.cases.json";

type ExpectedLabel =
  | "Directive"
  | "Preference"
  | "Belief"
  | "Habit"
  | "Goal"
  | "Task"
  | "null";

interface Case {
  id: string;
  fact: string;
  oldAspect: string;
  expected: ExpectedLabel;
  reason: string;
}

const CASES: Case[] = CASES_RAW as Case[];

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!HAS_KEY)("classify-voice held-out eval (live API)", () => {
  const RESULTS = new Map<string, string | null | undefined>();

  beforeAll(async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const model = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";
    const BATCH = Number(process.env.EVAL_BATCH_SIZE ?? "30");

    const inputSchema = z.toJSONSchema(ClassifyVoiceSchema);
    const allFacts = CASES.map((c) => ({ fact: c.fact }));

    console.log(
      `[eval] model=${model} cases=${CASES.length} batchSize=${BATCH}`,
    );
    const t0 = Date.now();

    // Batch to stay under context / max_tokens comfortably
    for (let i = 0; i < allFacts.length; i += BATCH) {
      const chunk = allFacts.slice(i, i + BATCH);
      const messages = classifyVoicePrompt(chunk);
      const system = messages.find((m) => m.role === "system")!.content as string;
      const userMsg = messages.find((m) => m.role === "user")!.content as string;

      const res = await client.messages.create({
        model,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: userMsg }],
        tools: [
          {
            name: "classify_voice",
            description: "Classify each voice fact into an aspect (or null).",
            input_schema: inputSchema as any,
          },
        ],
        tool_choice: { type: "tool", name: "classify_voice" },
      });

      const toolUse = res.content.find((b: any) => b.type === "tool_use") as any;
      if (!toolUse) {
        throw new Error(
          `Batch ${i}: no tool_use block: ${JSON.stringify(res.content)}`,
        );
      }
      const parsed = ClassifyVoiceSchema.parse(toolUse.input);
      for (const o of parsed.aspects) {
        RESULTS.set(o.fact, o.aspect);
      }
    }

    const dur = Date.now() - t0;

    // Print summary
    let pass = 0;
    const confusion: Record<string, Record<string, number>> = {};
    const byBucket: Record<string, { pass: number; fail: number }> = {};

    for (const c of CASES) {
      const got = RESULTS.get(c.fact);
      const gotStr =
        got === undefined ? "<MISSING>" : got === null ? "null" : got;
      const ok = gotStr === c.expected;
      if (ok) pass++;

      const bucket = `${c.oldAspect}→${c.expected}`;
      (byBucket[bucket] ??= { pass: 0, fail: 0 })[ok ? "pass" : "fail"]++;

      (confusion[c.expected] ??= {})[gotStr] =
        (confusion[c.expected]?.[gotStr] ?? 0) + 1;
    }

    console.log(
      `\n[eval] pass=${pass}/${CASES.length} (${((100 * pass) / CASES.length).toFixed(1)}%) dur=${dur}ms\n`,
    );

    // Per-bucket accuracy
    console.log("Per-bucket accuracy:");
    for (const [bucket, s] of Object.entries(byBucket).sort()) {
      const total = s.pass + s.fail;
      const pct = ((100 * s.pass) / total).toFixed(0);
      console.log(
        `  ${bucket.padEnd(30)} ${s.pass}/${total}  (${pct}%)`,
      );
    }

    // Confusion matrix
    console.log("\nConfusion (rows=expected, cols=got):");
    for (const [exp, gots] of Object.entries(confusion).sort()) {
      const parts = Object.entries(gots)
        .sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `${g}:${n}`)
        .join(", ");
      console.log(`  ${exp.padEnd(12)} → ${parts}`);
    }

    // Failing cases (grouped)
    const failing = CASES.filter((c) => {
      const got = RESULTS.get(c.fact);
      const gotStr =
        got === undefined ? "<MISSING>" : got === null ? "null" : got;
      return gotStr !== c.expected;
    });
    if (failing.length > 0) {
      console.log(`\nFailing cases (${failing.length}):`);
      for (const c of failing) {
        const got = RESULTS.get(c.fact);
        const gotStr =
          got === undefined ? "<MISSING>" : got === null ? "null" : got;
        console.log(
          `  [${c.id}] ${c.oldAspect}→${c.expected}, got=${gotStr}`,
        );
        console.log(`     reason: ${c.reason}`);
        console.log(`     fact: ${c.fact.slice(0, 130)}${c.fact.length > 130 ? "…" : ""}`);
      }
    }
  }, /* timeout */ 300_000);

  for (const c of CASES) {
    test(`${c.id}: ${c.oldAspect}→${c.expected} — ${c.reason}`, () => {
      const got = RESULTS.get(c.fact);
      const gotStr =
        got === undefined ? "<MISSING>" : got === null ? "null" : got;
      expect(gotStr, `fact: ${c.fact.slice(0, 120)}…`).toBe(c.expected);
    });
  }
});
