import { z } from "zod";
import { logger } from "~/services/logger.service";
import { createAgent, resolveModelString } from "~/lib/model.server";
import type { StatementAspect } from "@core/types";
import type { SectionStructure } from "./persona-bullet-ops";

const SubsectionNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[\w][\w \-/&]+$/, "subsection name must be 1-3 short words");

const BulletStringSchema = z.string().min(1).max(300);

const SkipSchema = z.object({
  decision: z.literal("skip"),
  reason: z.string(),
});

const AppendToSubsectionSchema = z.object({
  decision: z.literal("append_to_subsection"),
  subsection: SubsectionNameSchema,
  bullet: BulletStringSchema,
});

const PromoteToNewSubsectionSchema = z.object({
  decision: z.literal("promote_to_new_subsection"),
  subsection: SubsectionNameSchema,
  prose: z.string().min(1).max(600),
  bullets: z.array(BulletStringSchema).min(1),
  promoted_loose_ids: z.array(z.string().regex(/^L\d+$/)).min(1),
});

const AddToLooseFactsSchema = z.object({
  decision: z.literal("add_to_loose_facts"),
  bullet: BulletStringSchema,
});

export const PlacementDecisionSchema = z.discriminatedUnion("decision", [
  SkipSchema,
  AppendToSubsectionSchema,
  PromoteToNewSubsectionSchema,
  AddToLooseFactsSchema,
]);

export type PlacementDecision = z.infer<typeof PlacementDecisionSchema>;

// Batched form: same variants, but `promoted_loose_ids` may be empty
// because a cluster can be formed entirely from new facts of one
// episode (no loose facts need migrating).
const BatchPromoteSchema = PromoteToNewSubsectionSchema.extend({
  promoted_loose_ids: z.array(z.string().regex(/^L\d+$/)).default([]),
});

const BatchDecisionSchema = z.discriminatedUnion("decision", [
  SkipSchema,
  AppendToSubsectionSchema,
  BatchPromoteSchema,
  AddToLooseFactsSchema,
]);

export interface PlacementInput {
  aspect: StatementAspect;
  fact: string;
  structure: SectionStructure;
  filterGuidance: string;
}

const RUBRIC = `
============================================================
STEP 0 — PERSONA-WORTHINESS GATE (apply BEFORE anything else)
============================================================

The fact has already been labelled by an upstream classifier — that
label is NECESSARY but NOT SUFFICIENT. Most labelled facts will still
fail this gate. Default is skip.

----------- THE UNIFIED RULE -----------

A fact is persona-worthy if and only if an agent would apply it on
EVERY future task where its dimension is relevant — independent of
the specific tool, feature, project, schedule, or episode the fact
came from.

Apply this single test:

  > "Would a fresh agent, working on something completely unrelated
  > to where this fact came from, still need this fact to act
  > correctly?"
  > If no → skip.

Aspect-specific reading of the rule:
  - IDENTITY  → keep if an agent needs it on every task to act on the
                user's behalf (introduce, address, contact, attribute).
                Drop possessions, biometrics, account numbers,
                workload counts — those are about the user but only
                relevant when the task is about that thing; memory
                will retrieve them when needed.
  - PREFERENCE → keep if it shapes agent behaviour across many tools,
                features, and tasks. Skip preferences scoped to one
                tool/feature/episode.
  - DIRECTIVE → keep if its violation would be a defect on ANY future
                task. Skip rules whose authority is scoped to one
                feature/file/job — that's feature config.

Anchors (apply to all aspects):
  Keep — "primary email manoj@poozle.dev", "founder tone in writing",
         "never auto-send messages", "use IST as default timezone"
  Skip — "31% body fat", "Linear widget shows assigned issues",
         "Email N column stops sequence", "Plan My Day at 5:15 PM IST",
         "modify decision-agent.ts", "subscribed to Birkenstock"

----------- WORKING HEURISTIC -----------

If a fact mentions a NAMED artifact — a specific tool, widget, file,
function, repo, ticket, column, schedule, job, workflow, gateway,
pipeline stage — that's a strong signal it's feature config, not
persona. Skip unless the rule it expresses clearly applies far
beyond that one artifact.

If you'd name a subsection after a feature, workflow, or schedule,
the cluster itself is feature config. Skip every fact in it.

SATURATION: if the section already has ≥ 8 subsections, prefer "skip"
over a 9th unless the fact unambiguously belongs to an existing one.

When in doubt, skip. The persona stays useful by staying small.

If the gate passes, decide which of the four placement variants applies:

1. "skip" — the fact failed the gate, or is a one-off / noise /
   project-specific. Set { decision: "skip", reason: "<short>" }.

2. "append_to_subsection" — the fact's topic is already represented by an
   existing ### subsection. Set { decision, subsection: "<EXACT existing name>",
   bullet: "<polished sentence, no leading dash>" }.

3. "promote_to_new_subsection" — the new fact + ≥ 1 existing loose facts share
   a clear topic AND that topic is a STANDING pattern (not a one-feature
   setup). Choose ≥ 1 loose-fact IDs to promote (the new fact is implicit —
   never list it among promoted IDs). Generate a short prose paragraph
   (1-3 sentences) capturing the topic's contextual frame, plus the initial
   bullets (the new fact's bullet first, then promoted facts). Subsection
   name is 1-3 words, topic-shaped, MUST NOT duplicate an existing name
   (case-insensitive). Do NOT promote if the topic only describes one
   feature/task/workflow you built once.

4. "add_to_loose_facts" — passes the gate but is too isolated to cluster.
   Set { decision, bullet: "<polished sentence>" }.

CONSTRAINTS:
- Output strictly a single JSON object matching one of the variants. No prose,
  no markdown fences, no commentary.
- Bullets are single sentences, ≤ 20 words, active voice, no leading "- ".
- Subsection names: 1-3 words, no special characters except "-" or "/".
- Never propose any operation that modifies existing prose, renames headings,
  or deletes any bullet other than via the \`promoted_loose_ids\` list.
`;

const FEW_SHOT = `
EXAMPLE G1 (skip — feature-config detector, named artifact):
  aspect: Directive
  fact: "Order summary widget shows the last three deliveries with status badges"
  → { "decision": "skip", "reason": "names a specific widget — feature config, not persona" }

EXAMPLE G2 (skip — implementation guidance, named function/file):
  aspect: Directive
  fact: "Build the inventory cache in inventoryStore.refresh() before serving the dashboard"
  → { "decision": "skip", "reason": "names a specific function — implementation detail, not persona" }

EXAMPLE G3 (skip — schedule/cadence, named job):
  aspect: Directive
  fact: "Garden Care reminder runs daily at 7:00 AM IST"
  → { "decision": "skip", "reason": "specific job schedule lives on the reminder, not the persona" }

EXAMPLE G4 (skip — observation, body composition):
  aspect: Identity
  fact: "Resting heart rate is 58 bpm with VO2 max around 42"
  → { "decision": "skip", "reason": "biometric observation, not behaviour an agent should follow" }

EXAMPLE G5 (skip — observation, possession/account):
  aspect: Identity
  fact: "Holds a savings account at SBI ending in 4421"
  → { "decision": "skip", "reason": "account number / vendor relationship; not persona-worthy" }

EXAMPLE G6 (skip — one-feature artifact):
  aspect: Directive
  fact: "Mark Step 2 as Skipped if the upstream Step 1 row has 'pending'"
  → { "decision": "skip", "reason": "describes one workflow's status semantics — feature config, not standing rule" }

EXAMPLE G7 (skip — already implied):
  aspect: Preference
  fact: "Wants conversational tone in customer replies"
  existing subsection: "Voice" with bullet "Direct and conversational, no corporate filler"
  → { "decision": "skip", "reason": "already implied by existing voice rule" }

EXAMPLE G8 (skip — one-off):
  aspect: Preference
  fact: "Wanted bold headers in last week's report"
  → { "decision": "skip", "reason": "one-off styling request, not a standing preference" }

EXAMPLE P1 (append_to_subsection — passes gate):
  aspect: Preference
  fact: "Avoids hedging language like 'might' or 'maybe' in summaries"
  existing subsection: "Voice" (4 bullets)
  → { "decision": "append_to_subsection", "subsection": "Voice",
      "bullet": "Avoids hedging language like 'might' or 'maybe' in summaries" }
  why kept: applies to every summary the agent writes, no artifact named, durable voice rule.

EXAMPLE P2 (promote_to_new_subsection — passes gate):
  aspect: Directive
  fact: "Confirm before placing any order over ₹5000"
  loose facts: L1 "Never auto-confirm purchases", L2 "Surface total cost before checkout"
  → { "decision": "promote_to_new_subsection",
      "subsection": "Spend gates",
      "prose": "Treat any spend as approval-gated — surface costs first and never auto-confirm.",
      "bullets": ["Confirm before placing any order over ₹5000", "Never auto-confirm purchases", "Surface total cost before checkout"],
      "promoted_loose_ids": ["L1", "L2"] }
  why kept: standing safety pattern across all paid flows; not tied to one feature.

EXAMPLE P3 (add_to_loose_facts — passes gate, isolated):
  aspect: Directive
  fact: "Never read SMS OTPs out loud"
  no related subsections, no related loose facts
  → { "decision": "add_to_loose_facts", "bullet": "Never read SMS OTPs out loud" }
  why kept: hard standing rule across many flows, no feature named.
`;

function summariseStructure(structure: SectionStructure): string {
  const subs = structure.subsections.length
    ? structure.subsections
        .map(
          (s) =>
            `  - "${s.name}" (${s.bulletCount} bullets) — first: ${JSON.stringify(s.proseFirstSentence)}`,
        )
        .join("\n")
    : "  (none)";
  const loose = structure.looseFacts.length
    ? structure.looseFacts.map((l) => `  ${l.id}: ${l.text}`).join("\n")
    : "  (none)";
  return `Existing subsections:\n${subs}\n\nExisting loose facts (refer to by id):\n${loose}`;
}

export function buildPlacementPrompt(input: PlacementInput): string {
  return `You are placing a NEW persona fact into an existing persona document section.

Aspect: ${input.aspect}
Filter guidance for this aspect:
${input.filterGuidance}

NEW FACT:
${input.fact}

${summariseStructure(input.structure)}

${RUBRIC}

${FEW_SHOT}

Now produce the JSON object for the NEW FACT above. Output JSON only.`;
}

export interface BatchPlacementInput {
  aspect: StatementAspect;
  facts: string[];
  structure: SectionStructure;
  filterGuidance: string;
  /** Optional source-episode prose for grounding/clustering context. */
  episodeContent?: string;
}

/**
 * Build the batched-placement prompt for multiple facts from a single
 * episode + aspect. The LLM is asked to return an ordered JSON array of
 * the same four decision variants. Decisions are applied sequentially by
 * the writer; later decisions may reference subsections created by
 * earlier decisions in the same array.
 */
export function buildBatchPlacementPrompt(input: BatchPlacementInput): string {
  const factList = input.facts
    .map((f, i) => `  ${i + 1}. ${f}`)
    .join("\n");

  const episodeBlock = input.episodeContent
    ? `\n\nSOURCE EPISODE (for context — do NOT copy verbatim):\n"""\n${truncateForPrompt(input.episodeContent, 3000)}\n"""\n`
    : "";

  return `You are placing MULTIPLE NEW persona facts (from a single source episode) into an existing persona document section. First apply the persona-worthiness gate to EACH fact independently — many will be "skip". Then, among the facts that pass, cluster facts that share a STANDING topic.

Aspect: ${input.aspect}
Filter guidance for this aspect:
${input.filterGuidance}

NEW FACTS (from one episode):
${factList}
${episodeBlock}
${summariseStructure(input.structure)}

${RUBRIC}

OUTPUT FORMAT FOR BATCH:
- Return a JSON ARRAY of decision objects, in the order you want them applied.
- Each item is one of the four variants above.
- Multiple new facts that share a topic SHOULD be combined into a single
  "promote_to_new_subsection" decision (use \`bullets\` to list all the
  related new-fact bullets, plus any related loose facts via
  \`promoted_loose_ids\`).
- A later decision may "append_to_subsection" using a subsection name that
  was just created by an earlier "promote_to_new_subsection" in the same
  array.
- Do NOT emit duplicate "promote_to_new_subsection" entries with the same
  subsection name. Do NOT propose subsection names that already exist
  (case-insensitive) unless using "append_to_subsection".
- Output strictly a single JSON array. No prose, no markdown fences.

${FEW_SHOT}

EXAMPLE (batch with mixed skip + keep — gate applied per fact):
  aspect: Directive
  facts (from one episode about building a "Daily Brief" feature):
    1. "Daily Brief widget runs at 8:00 AM IST every weekday"
    2. "Confirm before sending anything to external recipients"
    3. "Brief job stops if Slack channel ID is missing"
    4. "Never include sensitive financial figures in shared summaries"
  loose facts: (none)
  → [
      { "decision": "skip", "reason": "names a specific widget and schedule — feature config" },
      { "decision": "add_to_loose_facts", "bullet": "Confirm before sending anything to external recipients" },
      { "decision": "skip", "reason": "names a specific job and config field — feature config" },
      { "decision": "add_to_loose_facts", "bullet": "Never include sensitive financial figures in shared summaries" }
    ]
  why: facts 1 and 3 mention named artifacts (widget, schedule, job, config field) — feature config, skip. Facts 2 and 4 are durable rules that apply to many unrelated future tasks — keep.

Now produce the JSON array for the NEW FACTS above. Output JSON only.`;
}

function truncateForPrompt(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n... [truncated]";
}

/**
 * Batched placement: one LLM call decides placements for all NEW facts
 * from a single episode + aspect. Returns the validated decisions in
 * order, dropping any that fail schema validation. Returns null when the
 * call/parse fails outright (caller treats as "skip all for this aspect
 * this run").
 *
 * Note: \`promoted_loose_ids\` may be empty in the batched form when the
 * cluster is built purely from new facts (no loose facts to migrate).
 * The schema below is more permissive than the per-fact one for that
 * reason.
 */
export async function placeFactsInPersona(
  input: BatchPlacementInput,
): Promise<PlacementDecision[] | null> {
  if (input.facts.length === 0) return [];
  try {
    const modelId = await resolveModelString("chat", "medium");
    const agent = createAgent(modelId);
    const prompt = buildBatchPlacementPrompt(input);
    const result = await agent.generate({ role: "user", content: prompt });
    const raw = result.text;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn("placeFactsInPersona: LLM output not valid JSON", {
        aspect: input.aspect,
        rawPreview: raw.slice(0, 200),
      });
      return null;
    }

    if (!Array.isArray(parsed)) {
      logger.warn("placeFactsInPersona: LLM output is not an array", {
        aspect: input.aspect,
      });
      return null;
    }

    const decisions: PlacementDecision[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const validated = BatchDecisionSchema.safeParse(parsed[i]);
      if (!validated.success) {
        logger.warn("placeFactsInPersona: dropping malformed decision entry", {
          aspect: input.aspect,
          index: i,
          issues: validated.error.issues,
        });
        continue;
      }
      decisions.push(validated.data);
    }
    return decisions;
  } catch (err) {
    logger.error("placeFactsInPersona: LLM call failed", {
      aspect: input.aspect,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Per-add LLM placement call. Returns a validated PlacementDecision, or
 * null when the LLM call or schema validation fails. Callers must treat
 * null as "skip the fact for this run" — the next episode that touches
 * the same aspect will retry placement.
 */
export async function placeFactInPersona(
  input: PlacementInput,
): Promise<PlacementDecision | null> {
  try {
    const modelId = await resolveModelString("chat", "medium");
    const agent = createAgent(modelId);
    const prompt = buildPlacementPrompt(input);
    const result = await agent.generate({ role: "user", content: prompt });
    const raw = result.text;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn("placeFactInPersona: LLM output not valid JSON", {
        aspect: input.aspect,
        rawPreview: raw.slice(0, 200),
      });
      return null;
    }

    const validated = PlacementDecisionSchema.safeParse(parsed);
    if (!validated.success) {
      logger.warn("placeFactInPersona: LLM output failed schema", {
        aspect: input.aspect,
        issues: validated.error.issues,
      });
      return null;
    }
    return validated.data;
  } catch (err) {
    logger.error("placeFactInPersona: LLM call failed", {
      aspect: input.aspect,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
