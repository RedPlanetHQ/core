import { prisma } from "~/db.server";

export const getIntegrationAccount = async (
  integrationDefinitionId: string,
  userId: string,
) => {
  return await prisma.integrationAccount.findFirst({
    where: {
      integrationDefinitionId: integrationDefinitionId,
      integratedById: userId,
      isActive: true,
    },
    include: {
      integrationDefinition: true,
    },
  });
};

export const getIntegrationAccountForId = async (id: string) => {
  return await prisma.integrationAccount.findUnique({
    where: {
      id,
    },
  });
};

export const getIntegrationAccounts = async (
  userId: string,
  workspaceId: string,
) => {
  return prisma.integrationAccount.findMany({
    where: {
      integratedById: userId,
      isActive: true,
      workspaceId,
    },
    include: {
      integrationDefinition: true,
    },
  });
};

export const getIntegrationAccountForSlug = async (slug: string) => {
  return await prisma.integrationAccount.findFirst({
    where: {
      integrationDefinition: {
        slug,
      },
    },
  });
};

export const getConnectedIntegrationAccounts = async (
  userId: string,
  workspaceId: string,
) => {
  return prisma.integrationAccount.findMany({
    where: {
      workspaceId,
      integratedById: userId,
      isActive: true,
      deleted: null,
    },
    select: {
      id: true,
      accountId: true,
      settings: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      integrationDefinition: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          icon: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};

export const getIntegrationAccountBySlugAndUser = async (
  slug: string,
  userId: string,
  workspaceId: string,
) => {
  return await prisma.integrationAccount.findFirst({
    where: {
      integrationDefinition: {
        slug,
      },
      integratedById: userId,
      isActive: true,
      workspaceId,
    },
    include: {
      integrationDefinition: true,
    },
  });
};
