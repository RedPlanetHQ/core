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
  sessionId?: string;
}

export interface ListSkillsParams {
  limit?: number;
  cursor?: string;
}

const RESERVED_SKILL_TITLES = ["Persona", "Reading Guide", "Watch Rules"] as const;
type SkillType = "persona" | "reading-guide" | "watch-rules";

export const getDefaultSkill = async (
  workspaceId: string,
  skillType: SkillType,
) => {
  const titleMap: Record<SkillType, string> = {
    "persona": "Persona",
    "reading-guide": "Reading Guide",
    "watch-rules": "Watch Rules",
  };

  return prisma.document.findFirst({
    where: {
      workspaceId,
      type: "skill",
      title: titleMap[skillType],
      deleted: null,
    },
  });
};

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
  const isReserved = RESERVED_SKILL_TITLES.includes(params.title as any);
  if (isReserved && params.source !== "system") {
    throw new Error(`"${params.title}" is a reserved skill name and cannot be created by users.`);
  }

  // Strip skillType from non-system skills
  let metadata = params.metadata ?? {};
  if (params.source !== "system") {
    const { skillType: _stripped, ...rest } = metadata as Record<string, unknown>;
    metadata = rest;
  }

  const skill = await prisma.document.create({
    data: {
      title: params.title,
      content: params.content,
      source: params.source ?? "manual",
      type: "skill",
      labelIds: params.labelIds ?? [],
      metadata: metadata as any,
      editedBy: userId,
      workspaceId,
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
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
  source?: string,
) => {
  const existingSkill = await getSkill(skillId, workspaceId);

  if (!existingSkill) {
    return null;
  }

  const existingMeta = (existingSkill.metadata as Record<string, unknown>) ?? {};
  const isDefaultSkill = !!existingMeta.skillType;

  // Guard: reserved title cannot be changed by non-system callers
  if (updateData.title) {
    const isReserved = RESERVED_SKILL_TITLES.includes(updateData.title as any);
    if (isReserved && source !== "system") {
      throw new Error(`"${updateData.title}" is a reserved skill name.`);
    }
    // Default skills cannot have their title changed
    if (isDefaultSkill && source !== "system") {
      throw new Error("The title of a default skill cannot be changed.");
    }
  }

  // Strip skillType from metadata updates for non-system callers
  let metadataUpdate = updateData.metadata;
  if (metadataUpdate && source !== "system") {
    const { skillType: _stripped, ...rest } = metadataUpdate;
    metadataUpdate = rest;
  }

  const skill = await prisma.document.update({
    where: { id: skillId },
    data: {
      ...(updateData.title && source === "system" && { title: updateData.title }),
      ...(updateData.content !== undefined && { content: updateData.content }),
      ...(metadataUpdate && {
        metadata: {
          ...existingMeta,
          ...metadataUpdate,
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

  const existingMeta = (existingSkill.metadata as Record<string, unknown>) ?? {};
  if (existingSkill.source === "system" || existingMeta.skillType) {
    throw new Error("Default skills cannot be deleted.");
  }

  await prisma.document.update({
    where: { id: skillId },
    data: { deleted: new Date() },
  });

  return { success: true };
};
