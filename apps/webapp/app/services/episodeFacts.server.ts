import {
  getEpisodeStatements,
  getStatementsInvalidatedByEpisode,
} from "~/services/graphModels/episode";

export async function getEpisodeFacts(episodeUuid: string, userId: string) {
  try {
    const facts = await getEpisodeStatements({
      episodeUuid,
      userId,
    });

    const invalidFacts = await getStatementsInvalidatedByEpisode({
      episodeUuid,
      userId,
    });

    return {
      success: true,
      facts: facts.map((fact) => ({
        uuid: fact.uuid,
        fact: fact.fact,
        createdAt: fact.createdAt.toISOString(),
        validAt: fact.validAt.toISOString(),
        invalidAt: fact.invalidAt ? fact.invalidAt.toISOString() : null,
        attributes: fact.attributes,
      })),
      invalidFacts: invalidFacts.map((fact) => ({
        uuid: fact.uuid,
        fact: fact.fact,
        createdAt: fact.createdAt.toISOString(),
        validAt: fact.validAt.toISOString(),
        invalidAt: fact.invalidAt ? fact.invalidAt.toISOString() : null,
        attributes: fact.attributes,
      })),
    };
  } catch (error) {
    console.error("Error fetching episode facts:", error);
    return {
      success: false,
      error: "Failed to fetch episode facts",
      facts: [],
    };
  }
}

export async function getDocumentFacts(documentId: string, userId: string) {
  try {
    const facts = await getEpisodeStatements({
      episodeUuid,
      userId,
    });

    const invalidFacts = await getStatementsInvalidatedByEpisode({
      episodeUuid,
      userId,
    });

    return {
      success: true,
      facts: facts.map((fact) => ({
        uuid: fact.uuid,
        fact: fact.fact,
        createdAt: fact.createdAt.toISOString(),
        validAt: fact.validAt.toISOString(),
        invalidAt: fact.invalidAt ? fact.invalidAt.toISOString() : null,
        attributes: fact.attributes,
      })),
      invalidFacts: invalidFacts.map((fact) => ({
        uuid: fact.uuid,
        fact: fact.fact,
        createdAt: fact.createdAt.toISOString(),
        validAt: fact.validAt.toISOString(),
        invalidAt: fact.invalidAt ? fact.invalidAt.toISOString() : null,
        attributes: fact.attributes,
      })),
    };
  } catch (error) {
    console.error("Error fetching episode facts:", error);
    return {
      success: false,
      error: "Failed to fetch episode facts",
      facts: [],
    };
  }
}
