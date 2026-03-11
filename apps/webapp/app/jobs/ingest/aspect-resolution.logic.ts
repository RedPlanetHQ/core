/**
 * Aspect Resolution Logic
 *
 * Handles async deduplication for voice aspects.
 * Runs as a background job after voice aspects are saved during episode ingestion.
 *
 * For each newly saved voice aspect:
 * 1. Vector search for similar existing aspects (same user, same aspect type)
 * 2. LLM decides: duplicate (skip) / evolution (invalidate old, keep new) / new (keep both)
 */

import { type VoiceAspect } from "@core/types";
import { logger } from "~/services/logger.service";
import {
  getVoiceAspectsForEpisode,
  findSimilarVoiceAspects,
  invalidateVoiceAspect,
  deleteVoiceAspectEmbeddings,
  appendEpisodeToVoiceAspect,
} from "~/services/aspectStore.server";
import {
  aspectResolutionPrompt,
  AspectResolutionSchema,
} from "~/services/prompts/aspect-resolution";
import { makeStructuredModelCall } from "~/lib/model.server";
import { type ModelMessage } from "ai";
import { prisma } from "~/db.server";

export interface AspectResolutionPayload {
  episodeUuid: string;
  userId: string;
  workspaceId: string;
}

export interface AspectResolutionResult {
  success: boolean;
  duplicatesSkipped: number;
  evolutionsResolved: number;
  newKept: number;
  error?: string;
}

/**
 * Process voice aspect resolution for a newly ingested episode
 */
export async function processAspectResolution(
  payload: AspectResolutionPayload,
): Promise<AspectResolutionResult> {
  try {
    logger.info(
      `Processing aspect resolution for episode ${payload.episodeUuid}`,
    );

    // Get newly saved voice aspects for this episode
    const newAspects = await getVoiceAspectsForEpisode(
      payload.episodeUuid,
      payload.userId,
    );

    if (newAspects.length === 0) {
      logger.info(
        `No voice aspects found for episode ${payload.episodeUuid}`,
      );
      return {
        success: true,
        duplicatesSkipped: 0,
        evolutionsResolved: 0,
        newKept: 0,
      };
    }

    logger.info(
      `Found ${newAspects.length} voice aspects for episode ${payload.episodeUuid}`,
    );

    // For each new aspect, find similar existing ones
    const aspectsWithSimilar = await Promise.all(
      newAspects.map(async (aspect) => {
        const similar = await findSimilarVoiceAspects({
          fact: aspect.fact,
          userId: payload.userId,
          workspaceId: payload.workspaceId,
          aspect: aspect.aspect,
          limit: 5,
          threshold: 0.75,
        });

        // Exclude the aspect itself from similar results
        const filtered = similar.filter((s) => s.uuid !== aspect.uuid);

        return { aspect, similar: filtered };
      }),
    );

    // Find aspects that have similar existing ones (need LLM resolution)
    const needsResolution = aspectsWithSimilar.filter(
      (a) => a.similar.length > 0,
    );

    // Aspects with no similar matches are automatically "new"
    const autoNew = aspectsWithSimilar.filter(
      (a) => a.similar.length === 0,
    ).length;

    let duplicatesSkipped = 0;
    let evolutionsResolved = 0;

    if (needsResolution.length > 0) {
      // Prepare data for LLM resolution
      const newForLLM = needsResolution.map((a) => ({
        id: a.aspect.uuid,
        fact: a.aspect.fact,
        aspect: a.aspect.aspect,
      }));

      // Collect all unique similar aspects
      const existingMap = new Map<
        string,
        { id: string; fact: string; aspect: string; score: number }
      >();
      for (const a of needsResolution) {
        for (const s of a.similar) {
          if (!existingMap.has(s.uuid)) {
            existingMap.set(s.uuid, {
              id: s.uuid,
              fact: s.fact,
              aspect: s.aspect,
              score: s.score,
            });
          }
        }
      }
      const existingForLLM = Array.from(existingMap.values());

      // LLM resolution
      const messages = aspectResolutionPrompt(newForLLM, existingForLLM);
      const { object: result } = await makeStructuredModelCall(
        AspectResolutionSchema,
        messages as ModelMessage[],
        "low",
        "aspect-resolution",
      );

      // Apply decisions
      for (const decision of result.decisions) {
        const matchedNew = needsResolution.find(
          (a) => a.aspect.uuid === decision.matched_aspect_id,
        );

        switch (decision.decision) {
          case "duplicate": {
            // The new aspect is a duplicate of an existing one.
            // Append the new episode UUID to the existing matched aspect,
            // then delete the new duplicate aspect and its embedding.
            const newIdx = result.decisions.indexOf(decision);
            const targetNew = needsResolution[newIdx];
            if (targetNew && decision.matched_aspect_id) {
              // Link this episode to the existing aspect
              await appendEpisodeToVoiceAspect(
                decision.matched_aspect_id,
                payload.episodeUuid,
              );
              // Delete the new duplicate
              await prisma.voiceAspect.delete({
                where: { id: targetNew.aspect.uuid },
              });
              await deleteVoiceAspectEmbeddings([targetNew.aspect.uuid]);
              duplicatesSkipped++;
              logger.info(
                `Duplicate aspect deleted: "${targetNew.aspect.fact}" → appended episode to existing ${decision.matched_aspect_id}`,
              );
            }
            break;
          }
          case "evolution": {
            // Invalidate the old aspect, keep the new one
            if (decision.matched_aspect_id) {
              await invalidateVoiceAspect(
                decision.matched_aspect_id,
                payload.episodeUuid,
              );
              evolutionsResolved++;
              logger.info(
                `Evolved aspect: invalidated ${decision.matched_aspect_id}, reason: ${decision.reason}`,
              );
            }
            break;
          }
          case "new":
            // Nothing to do — new aspect stays as-is
            break;
        }
      }
    }

    const result: AspectResolutionResult = {
      success: true,
      duplicatesSkipped,
      evolutionsResolved,
      newKept: autoNew + (needsResolution.length - duplicatesSkipped),
    };

    logger.info(
      `Aspect resolution completed: ${result.duplicatesSkipped} duplicates, ${result.evolutionsResolved} evolutions, ${result.newKept} new`,
    );

    return result;
  } catch (error: any) {
    logger.error(`Error in aspect resolution:`, { error });
    return {
      success: false,
      duplicatesSkipped: 0,
      evolutionsResolved: 0,
      newKept: 0,
      error: error.message,
    };
  }
}
