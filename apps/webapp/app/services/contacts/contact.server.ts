import { prisma } from "~/db.server";
import type { Contact, Prisma } from "@core/database";

export async function listContacts(
  workspaceId: string,
  query?: string,
): Promise<Contact[]> {
  const where: Prisma.ContactWhereInput = {
    workspaceId,
    status: { not: "Hidden" },
  };
  if (query && query.trim()) {
    const q = query.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { company: { contains: q, mode: "insensitive" } },
      { role: { contains: q, mode: "insensitive" } },
      { location: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { emails: { has: q } },
      { phones: { has: q } },
    ];
  }
  return prisma.contact.findMany({ where, orderBy: { updatedAt: "desc" } });
}

export async function getContact(
  workspaceId: string,
  contactId: string,
): Promise<Contact | null> {
  return prisma.contact.findFirst({ where: { id: contactId, workspaceId } });
}

export async function upsertContactForEntity(params: {
  workspaceId: string;
  userId: string;
  entityUuid: string;
  name: string;
}): Promise<Contact> {
  const { workspaceId, userId, entityUuid, name } = params;
  return prisma.contact.upsert({
    where: { workspaceId_entityUuid: { workspaceId, entityUuid } },
    create: { workspaceId, userId, entityUuid, name, source: "Auto" },
    update: { name },
  });
}

export async function updateContactFields(
  workspaceId: string,
  contactId: string,
  data: Prisma.ContactUpdateInput,
): Promise<void> {
  await prisma.contact.updateMany({
    where: { id: contactId, workspaceId },
    data,
  });
}

export async function hideContact(
  workspaceId: string,
  contactId: string,
): Promise<void> {
  await prisma.contact.updateMany({
    where: { id: contactId, workspaceId },
    data: { status: "Hidden" },
  });
}

export async function deleteContact(
  workspaceId: string,
  contactId: string,
): Promise<void> {
  await prisma.contact.deleteMany({
    where: { id: contactId, workspaceId },
  });
}
