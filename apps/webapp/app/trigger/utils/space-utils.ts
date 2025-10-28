import { prisma } from "./prisma";

export const getSpace = async (spaceId: string) => {
  const space = await prisma.space.findFirst({
    where: {
      id: spaceId,
    },
  });

  return space;
};

export const updateSpace = async (summaryData: {
  spaceId: string;
  summary: string;
  themes: string[];
  contextCount: number;
}) => {
  return await prisma.space.update({
    where: {
      id: summaryData.spaceId,
    },
    data: {
      summary: summaryData.summary,
      themes: summaryData.themes,
      contextCount: summaryData.contextCount,
      summaryGeneratedAt: new Date().toISOString(),
    },
  });
};
