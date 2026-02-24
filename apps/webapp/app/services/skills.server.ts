import { prisma } from "~/db.server";

export interface UpdateSkillParams {
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateSkillParams {
  title: string;
  content: string;
  source?: string;
  labelIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface ListSkillsParams {
  limit?: number;
  cursor?: string;
}

export const listSkills = async (
  workspaceId: string,
  params: ListSkillsParams = {},
) => {
  const { limit = 50, cursor } = params;

  const whereClause: {
    workspaceId: string;
    type: string;
    deleted?: null;
    createdAt?: { lt: Date };
  } = {
    workspaceId,
    type: "skill",
    deleted: null,
  };

  if (cursor) {
    whereClause.createdAt = {
      lt: new Date(cursor),
    };
  }

  const [skills, totalCount] = await Promise.all([
    prisma.document.findMany({
      where: whereClause,
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
    }),
    prisma.document.count({
      where: {
        workspaceId,
        type: "skill",
        deleted: null,
      },
    }),
  ]);

  const hasMore = skills.length === limit && totalCount > skills.length;
  const nextCursor =
    skills.length > 0
      ? skills[skills.length - 1].createdAt.toISOString()
      : null;

  return {
    skills,
    hasMore,
    nextCursor,
    totalCount,
  };
};

export const createSkill = async (
  workspaceId: string,
  userId: string,
  params: CreateSkillParams,
) => {
  const skill = await prisma.document.create({
    data: {
      title: params.title,
      content: params.content,
      source: params.source ?? "manual",
      type: "skill",
      labelIds: params.labelIds ?? [],
      metadata: (params.metadata ?? {}) as any,
      editedBy: userId,
      workspaceId,
    },
  });

  return skill;
};

export const getSkill = async (skillId: string, workspaceId: string) => {
  const skill = await prisma.document.findFirst({
    where: {
      id: skillId,
      workspaceId,
      type: "skill",
      deleted: null,
    },
  });

  return skill;
};

export const updateSkill = async (
  skillId: string,
  workspaceId: string,
  userId: string,
  updateData: UpdateSkillParams,
) => {
  const existingSkill = await getSkill(skillId, workspaceId);

  if (!existingSkill) {
    return null;
  }

  const skill = await prisma.document.update({
    where: { id: skillId },
    data: {
      ...(updateData.title && { title: updateData.title }),
      ...(updateData.content && { content: updateData.content }),
      ...(updateData.metadata && {
        metadata: {
          ...((existingSkill.metadata as Record<string, unknown>) ?? {}),
          ...updateData.metadata,
        },
      }),
      editedBy: userId,
    },
  });

  return skill;
};

export const deleteSkill = async (skillId: string, workspaceId: string) => {
  const existingSkill = await getSkill(skillId, workspaceId);

  if (!existingSkill) {
    return null;
  }

  await prisma.document.update({
    where: { id: skillId },
    data: { deleted: new Date() },
  });

  return { success: true };
};
