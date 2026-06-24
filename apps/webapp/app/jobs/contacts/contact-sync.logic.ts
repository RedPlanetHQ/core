import { logger } from "~/services/logger.service";
import { prisma } from "~/db.server";
import { getPersonContactCandidates } from "~/services/graphModels/entity";
import { getEpisodesForEntity, getEpisode } from "~/services/graphModels/episode";
import {
  upsertContactForEntity,
  updateContactFields,
} from "~/services/contacts/contact.server";
import { generateContactSummary } from "~/services/contacts/contact-summary.server";

export const SUMMARY_THROTTLE_MS = 24 * 60 * 60 * 1000;

export function isSelf(userName: string, candidateName: string): boolean {
  return userName.trim().toLowerCase() === candidateName.trim().toLowerCase();
}

export function needsRefresh(
  lastSummarizedAt: Date | null,
  latestFactAt: Date | null,
): boolean {
  if (!latestFactAt) return false;
  if (!lastSummarizedAt) return true;
  return latestFactAt.getTime() > lastSummarizedAt.getTime();
}

// 24h throttle: new contacts (no row yet) summarize immediately. Existing
// contacts summarize unless they were summarized within the last 24h.
// `force` (manual refresh from UI) bypasses the throttle.
export function isWithinThrottle(
  lastSummarizedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastSummarizedAt) return false;
  return now.getTime() - lastSummarizedAt.getTime() < SUMMARY_THROTTLE_MS;
}

export interface SyncContactForEntityInput {
  workspaceId: string;
  userId: string;
  userName: string;
  entityUuid: string;
  name: string;
  latestFactAt: Date | null;
  force?: boolean;
  // UUID of the episode that triggered this sync — guaranteed to be included
  // in the context window even if the provenance link isn't indexed yet.
  episodeUuid?: string;
}

export type SyncOutcome = "skipped" | "created" | "refreshed";

export async function syncContactForEntity(
  input: SyncContactForEntityInput,
): Promise<SyncOutcome> {
  const { workspaceId, userId, userName, entityUuid, name, latestFactAt, force, episodeUuid } = input;

  if (isSelf(userName, name)) return "skipped";

  const existing = await prisma.contact.findUnique({
    where: { workspaceId_entityUuid: { workspaceId, entityUuid } },
  });
  if (existing?.status === "Hidden") return "skipped";

  const isNew = !existing;
  const contact =
    existing ??
    (await upsertContactForEntity({ workspaceId, userId, entityUuid, name }));

  if (!isNew && !force && isWithinThrottle(contact.lastSummarizedAt)) {
    return "skipped";
  }

  const episodes = await getEpisodesForEntity(entityUuid, userId, workspaceId, 5);

  // Guarantee the triggering episode is always in the context window.
  // If the provenance link isn't indexed yet it may be missing from the query.
  if (episodeUuid && !episodes.some((e) => e.uuid === episodeUuid)) {
    const current = await getEpisode(episodeUuid);
    if (current) episodes.unshift(current);
    if (episodes.length > 5) episodes.length = 5;
  }

  if (episodes.length === 0) {
    // Nothing to summarize yet — leave the row in place and retry on the next episode.
    return isNew ? "created" : "skipped";
  }

  const { headline, description, extractedFields } = await generateContactSummary(
    {
      userName,
      personName: name,
      today: new Date(),
      episodes: episodes.map((e) => ({
        content: e.content,
        // Provider returns raw Cypher results where dates come back as ISO strings.
        // Coerce so the summary builder can call .toISOString() safely.
        validAt: e.validAt instanceof Date ? e.validAt : new Date(e.validAt as unknown as string),
      })),
      priorDescription: contact.description ?? null,
      descriptionEdited: contact.descriptionEdited,
    },
    workspaceId,
  );

  // Build field updates: only overwrite a structured field when the LLM
  // extracted a non-empty value, so manually edited values aren't cleared.
  const fieldUpdates: Record<string, any> = {
    headline,
    description,
    status: "Active",
    lastMemoryAt: latestFactAt ?? new Date(),
    lastSummarizedAt: new Date(),
  };
  if (extractedFields.email) fieldUpdates.emails = [extractedFields.email];
  if (extractedFields.phone) fieldUpdates.phones = [extractedFields.phone];
  if (extractedFields.company) fieldUpdates.company = extractedFields.company;
  if (extractedFields.role) fieldUpdates.role = extractedFields.role;
  if (extractedFields.location) fieldUpdates.location = extractedFields.location;
  if (extractedFields.category) fieldUpdates.category = extractedFields.category;
  const newHandles = [extractedFields.linkedin, extractedFields.twitter].filter(Boolean);
  if (newHandles.length > 0) fieldUpdates.handles = newHandles;

  await updateContactFields(workspaceId, contact.id, fieldUpdates);

  return isNew ? "created" : "refreshed";
}

export interface ContactSyncPayload {
  userId: string;
  workspaceId: string;
  userName: string;
}

// Sweep helper retained for tests / ad-hoc backfills. The nightly cron has
// been replaced by the inline ingest hook in graph-resolution.
export async function processContactSync(payload: ContactSyncPayload) {
  const { userId, workspaceId, userName } = payload;
  const candidates = await getPersonContactCandidates(userId, workspaceId);

  let created = 0;
  let refreshed = 0;

  for (const c of candidates) {
    const outcome = await syncContactForEntity({
      workspaceId,
      userId,
      userName,
      entityUuid: c.uuid,
      name: c.name,
      latestFactAt: c.latestFactAt,
    });
    if (outcome === "created") created++;
    else if (outcome === "refreshed") refreshed++;
  }

  logger.info(`Contact sync done`, { userId, workspaceId, created, refreshed });
  return { created, refreshed };
}
