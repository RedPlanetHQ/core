// //

// import { task } from "@trigger.dev/sdk";
// import { prisma } from "./utils/prisma";
// import { preprocessTask } from "./ingest/preprocess-episode";
// import { sessionCompactionTask } from "./session/session-compaction";
// import { populateEmbeddingWorkspaceIds } from "~/migration";

// export const migrationTask = task({
//   id: "migration",
//   maxDuration: 3000,
//   run: async (payload: any) => {
//     const documents = await prisma.document.findMany({
//       where: {
//         labelIds: { isEmpty: true },
//         createdAt: { gte: new Date("2026-02-01T00:00:00.000Z") },
//       },
//       select: {
//         id: true,
//         workspaceId: true,
//         metadata: true,
//         sessionId: true,
//       },
//     });

//     const sessionIds = documents
//       .map((d) => d.sessionId)
//       .filter(Boolean) as string[];

//     const ingestionQueues = await prisma.ingestionQueue.findMany({
//       where: {
//         sessionId: { in: sessionIds },
//       },
//       select: {
//         id: true,
//         workspaceId: true,
//         sessionId: true,
//         createdAt: true,
//       },
//       orderBy: {
//         createdAt: "asc",
//       },
//     });
//   },
// });
