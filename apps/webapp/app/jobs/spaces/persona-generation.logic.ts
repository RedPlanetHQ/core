import { logger } from "~/services/logger.service";
import { type z } from "zod";

import { prisma } from "~/db.server";
import { checkPersonaUpdateThreshold } from "./persona-trigger.logic";
import { type IngestBodyRequest } from "~/trigger/ingest/ingest";
import {
  generateAspectBasedPersona,
  ASPECT_SECTION_MAP,
} from "./aspect-persona-generation";
import {
  appendTombstone,
  applyPlacementDecision,
  parseSectionStructure,
  PERSONA_ASPECTS,
} from "./persona-bullet-ops";
import {
  placeFactInPersona,
  placeFactsInPersona,
} from "./persona-llm-placement";
import { savePersonaDocument } from "./utils";
import { getPersonaDocumentRecordForUser } from "~/services/document.server";
import {
  getStatementsForEpisodeByAspects,
  getInvalidatedStatementsForEpisode,
} from "~/services/graphModels/statement";
import {
  getVoiceAspectsForEpisode,
  getInvalidatedVoiceAspectsForEpisode,
} from "~/services/aspectStore.server";
import { getEpisode } from "~/services/graphModels/episode";
import type { StatementAspect, VoiceAspect } from "@core/types";
import { GRAPH_ASPECTS, VOICE_ASPECTS } from "@core/types";

// Payload for the persona worker — only one shape: a "an episode happened"
// signal. Tombstones are folded into the same per-episode pass via direct
// graph queries; there is no separate tombstone payload.
export interface PersonaGenerationPayload {
  userId: string;
  workspaceId: string;
  episodeUuid?: string;
}

export interface PersonaGenerationResult {
  success: boolean;
  labelId: string;
  mode: string;
  summaryLength: number;
  episodesProcessed: number;
}

interface WorkspaceMetadata {
  lastPersonaGenerationAt?: string;
  [key: string]: any;
}

const GRAPH_ASPECTS_SET = new Set<string>(GRAPH_ASPECTS);
const VOICE_ASPECTS_SET = new Set<string>(VOICE_ASPECTS);
const PERSONA_GRAPH_ASPECTS: StatementAspect[] = PERSONA_ASPECTS.filter((a) =>
  GRAPH_ASPECTS_SET.has(a),
);
const PERSONA_VOICE_ASPECTS: VoiceAspect[] = PERSONA_ASPECTS.filter(
  (a): a is VoiceAspect => VOICE_ASPECTS_SET.has(a),
);

async function updateLastPersonaGenerationTime(
  workspaceId: string,
): Promise<void> {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { metadata: true },
    });
    if (!workspace) return;
    const metadata = (workspace.metadata || {}) as WorkspaceMetadata;
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        metadata: {
          ...metadata,
          lastPersonaGenerationAt: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    logger.error("Error updating last persona generation timestamp", { error });
  }
}

function sectionTitleFor(aspect: StatementAspect): string {
  const entry = ASPECT_SECTION_MAP[aspect];
  if (!entry) {
    // PERSONA_ASPECTS and ASPECT_SECTION_MAP are independent — guard against
    // drift surfacing as a silent `undefined.title` TypeError later.
    throw new Error(`No ASPECT_SECTION_MAP entry for aspect: ${aspect}`);
  }
  return entry.title;
}

async function fetchEpisodeFactsForPersona(
  userId: string,
  episodeUuid: string,
): Promise<{
  validFacts: Array<{ aspect: StatementAspect; fact: string }>;
  invalidatedFacts: Array<{ aspect: StatementAspect; fact: string }>;
}> {
  const [
    graphValid,
    voiceValid,
    graphInvalidated,
    voiceInvalidated,
  ] = await Promise.all([
    getStatementsForEpisodeByAspects(episodeUuid, PERSONA_GRAPH_ASPECTS),
    getVoiceAspectsForEpisode(episodeUuid, userId, PERSONA_VOICE_ASPECTS),
    getInvalidatedStatementsForEpisode(episodeUuid, userId, PERSONA_GRAPH_ASPECTS),
    getInvalidatedVoiceAspectsForEpisode(episodeUuid, userId, PERSONA_VOICE_ASPECTS),
  ]);
  const validFacts = [
    ...graphValid.map((s) => ({ aspect: s.aspect as StatementAspect, fact: s.fact })),
    ...voiceValid.map((va) => ({ aspect: va.aspect as StatementAspect, fact: va.fact })),
  ];
  const invalidatedFacts = [
    ...graphInvalidated.map((s) => ({ aspect: s.aspect, fact: s.fact })),
    ...voiceInvalidated.map((va) => ({
      aspect: va.aspect as StatementAspect,
      fact: va.fact,
    })),
  ];
  return { validFacts, invalidatedFacts };
}

/**
 * Process persona generation job (BullMQ worker entry point).
 *
 * Single per-episode pass:
 *   1. No existing doc → first-time full generation.
 *   2. Existing doc + mode "full" → no-op (forbidden by invariant).
 *   3. Existing doc + mode "incremental" + episodeUuid →
 *        a. Tombstones for invalidated facts.
 *        b. Placements for new valid facts.
 *        c. Single save.
 */
export async function processPersonaGeneration(
  payload: PersonaGenerationPayload,
  _addToQueue: (
    body: z.infer<typeof IngestBodyRequest>,
    userId: string,
    activityId?: string,
    ingestionQueueId?: string,
  ) => Promise<{ id?: string }>,
): Promise<PersonaGenerationResult> {
  const { userId, workspaceId, episodeUuid } = payload;
  const thresholdCheck = await checkPersonaUpdateThreshold(
    userId,
    workspaceId,
    episodeUuid,
  );
  if (!thresholdCheck.shouldGenerate || !thresholdCheck.labelId || !thresholdCheck.mode) {
    return {
      success: false,
      labelId: thresholdCheck.labelId || "",
      mode: thresholdCheck.mode || "full",
      summaryLength: 0,
      episodesProcessed: 0,
    };
  }
  const { labelId, mode } = thresholdCheck;

  const existing = await getPersonaDocumentRecordForUser(workspaceId);

  if (!existing) {
    // First-time generation.
    logger.info("Running first-time persona generation", { userId });
    const summary = await generateAspectBasedPersona(userId);
    await savePersonaDocument(workspaceId, userId, summary, labelId);
    await updateLastPersonaGenerationTime(workspaceId);
    return {
      success: true,
      labelId,
      mode,
      summaryLength: summary.length,
      episodesProcessed: 0,
    };
  }

  if (mode === "full") {
    // Forbidden by invariant — never replace an existing doc.
    logger.info(
      "Persona doc exists — full regen not permitted by invariant; skipping",
      { userId, workspaceId },
    );
    return {
      success: false,
      labelId,
      mode,
      summaryLength: existing.content.length,
      episodesProcessed: 0,
    };
  }

  if (mode !== "incremental" || !episodeUuid) {
    // Nothing actionable.
    return {
      success: false,
      labelId,
      mode,
      summaryLength: existing.content.length,
      episodesProcessed: 0,
    };
  }

  // Single-pass: tombstones first, placements second.
  logger.info("Running per-episode persona update", { userId, episodeUuid });
  const { validFacts, invalidatedFacts } = await fetchEpisodeFactsForPersona(
    userId,
    episodeUuid,
  );

  if (validFacts.length === 0 && invalidatedFacts.length === 0) {
    // Episode produced no persona-relevant changes — nothing to do.
    return {
      success: true,
      labelId,
      mode,
      summaryLength: existing.content.length,
      episodesProcessed: 0,
    };
  }

  let doc = existing.content;

  // Step A: tombstones first. Pure code, no LLM.
  for (const { aspect, fact } of invalidatedFacts) {
    const title = sectionTitleFor(aspect);
    doc = appendTombstone(doc, title, fact);
  }

  // Step B: placements second. Group facts by aspect so the LLM can
  // cluster related facts from the same episode in one shot. Single-fact
  // groups go through the per-fact path (cheaper, no episode context
  // needed). Multi-fact groups use the batched path with episode content.
  const factsByAspect = new Map<StatementAspect, string[]>();
  for (const { aspect, fact } of validFacts) {
    const list = factsByAspect.get(aspect) ?? [];
    list.push(fact);
    factsByAspect.set(aspect, list);
  }

  // Lazy-load episode content once, only if any aspect group has ≥ 2 facts.
  let episodeContent: string | undefined;
  const needsEpisodeContent = Array.from(factsByAspect.values()).some(
    (facts) => facts.length >= 2,
  );
  if (needsEpisodeContent) {
    try {
      const ep = await getEpisode(episodeUuid);
      episodeContent = ep?.content ?? undefined;
    } catch (err) {
      logger.warn("Failed to load episode content for batched placement", {
        episodeUuid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const [aspect, facts] of factsByAspect) {
    const title = sectionTitleFor(aspect);

    if (facts.length === 1) {
      // Per-fact fast path — no episode context, single decision.
      const structure = parseSectionStructure(doc, title);
      const looseIdToText = new Map(
        structure.looseFacts.map((l) => [l.id, l.text]),
      );
      const decision = await placeFactInPersona({
        aspect,
        fact: facts[0],
        structure,
        filterGuidance: ASPECT_SECTION_MAP[aspect].filterGuidance,
      });
      if (!decision) continue;
      doc = applyPlacementDecision(doc, title, decision, looseIdToText);
      continue;
    }

    // Batched path — one LLM call yields ordered decisions. Recompute
    // structure between each so a `promote` followed by `append_to_subsection`
    // referencing the new subsection name resolves correctly.
    const initialStructure = parseSectionStructure(doc, title);
    const decisions = await placeFactsInPersona({
      aspect,
      facts,
      structure: initialStructure,
      filterGuidance: ASPECT_SECTION_MAP[aspect].filterGuidance,
      episodeContent,
    });
    if (!decisions || decisions.length === 0) continue;

    for (const decision of decisions) {
      const structure = parseSectionStructure(doc, title);
      const looseIdToText = new Map(
        structure.looseFacts.map((l) => [l.id, l.text]),
      );
      doc = applyPlacementDecision(doc, title, decision, looseIdToText);
    }
  }

  if (doc !== existing.content) {
    await savePersonaDocument(workspaceId, userId, doc, labelId);
    await updateLastPersonaGenerationTime(workspaceId);
  }

  return {
    success: true,
    labelId,
    mode,
    summaryLength: doc.length,
    episodesProcessed: 1,
  };
}
