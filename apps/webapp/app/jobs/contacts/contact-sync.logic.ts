import { logger } from "~/services/logger.service";
import { prisma } from "~/db.server";
import {
  getPersonContactCandidates,
  getEntityFacts,
} from "~/services/graphModels/entity";
import {
  upsertContactForEntity,
  updateContactFields,
} from "~/services/contacts/contact.server";
import { generateContactSummary } from "~/services/contacts/contact-summary.server";

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

export interface ContactSyncPayload {
  userId: string;
  workspaceId: string;
  userName: string;
}

export async function processContactSync(payload: ContactSyncPayload) {
  const { userId, workspaceId, userName } = payload;
  const candidates = await getPersonContactCandidates(userId, workspaceId);

  let created = 0;
  let refreshed = 0;

  for (const c of candidates) {
    if (isSelf(userName, c.name)) continue;

    const existing = await prisma.contact.findUnique({
      where: { workspaceId_entityUuid: { workspaceId, entityUuid: c.uuid } },
    });
    if (existing?.status === "Hidden") continue;

    const contact =
      existing ??
      (await upsertContactForEntity({
        workspaceId,
        userId,
        entityUuid: c.uuid,
        name: c.name,
      }));
    if (!existing) created++;

    if (!needsRefresh(contact.lastSummarizedAt, c.latestFactAt)) continue;

    const facts = await getEntityFacts(c.uuid, userId, workspaceId);
    const { headline, description } = await generateContactSummary(
      {
        userName,
        personName: c.name,
        today: new Date(),
        contactFields: {
          emails: contact.emails,
          phones: contact.phones,
          company: contact.company ?? null,
          role: contact.role ?? null,
          location: contact.location ?? null,
          handles: contact.handles,
        },
        facts,
        priorDescription: contact.description ?? null,
        descriptionEdited: contact.descriptionEdited,
      },
      workspaceId,
    );

    await updateContactFields(workspaceId, contact.id, {
      headline,
      description,
      status: "Active",
      lastMemoryAt: c.latestFactAt,
      lastSummarizedAt: new Date(),
    });
    refreshed++;
  }

  logger.info(`Contact sync done`, { userId, workspaceId, created, refreshed });
  return { created, refreshed };
}
