import { json } from "@remix-run/node";
import { z } from "zod";
import { prisma } from "~/db.server";

import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";

// Schema for logs search parameters
const DocumentsSearchParams = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  sessionId: z.string().optional(),
  label: z.string().optional(),
  cursor: z.string().optional(), // cursor for pagination (createdAt timestamp)
});

export const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    searchParams: DocumentsSearchParams,
    corsStrategy: "all",
    findResource: async () => 1,
  },
  async ({ authentication, searchParams }) => {
    const page = parseInt(searchParams.page || "1");
    const limit = parseInt(searchParams.limit || "25");
    const source = searchParams.source;
    const status = searchParams.status;
    const type = searchParams.type;
    const sessionId = searchParams.sessionId;
    const label = searchParams.label;
    const cursor = searchParams.cursor; // Cursor is a createdAt timestamp

    // Get user and workspace in one query
    const user = await prisma.user.findUnique({
      where: { id: authentication.userId },
      select: { Workspace: { select: { id: true } } },
    });

    if (!user?.Workspace) {
      throw new Response("Workspace not found", { status: 404 });
    }

    // Get all unique sources from integration accounts
    const integrationAccounts = await prisma.integrationAccount.findMany({
      where: {
        workspaceId: user.Workspace.id,
      },
      select: {
        integrationDefinition: {
          select: {
            name: true,
            slug: true,
          },
        },
      },
      distinct: ["integrationDefinitionId"],
    });

    // Get unique sources from document data field using raw SQL
    const uniqueDataSources = await prisma.$queryRaw<Array<{ source: string }>>`
      SELECT DISTINCT source
      FROM "Document"
      WHERE "workspaceId" = ${user.Workspace.id}
      AND source IS NOT NULL
    `;

    // Combine both sources
    const sourcesMap = new Map<string, { name: string; slug: string }>();

    // Add integration account sources
    integrationAccounts.forEach((account) => {
      if (account.integrationDefinition) {
        const { name, slug } = account.integrationDefinition;
        if (name && slug) {
          sourcesMap.set(slug, { name, slug });
        }
      }
    });

    // Add data field sources
    uniqueDataSources.forEach(({ source }) => {
      if (source) {
        const slug = source.toLowerCase().replace(/\s+/g, "-");
        if (!sourcesMap.has(slug)) {
          sourcesMap.set(slug, { name: source, slug });
        }
      }
    });

    const availableSources = Array.from(sourcesMap.values());

    // Build where clause for filtering
    const whereClause: any = {
      workspaceId: user.Workspace.id,
    };

    if (sessionId) {
      whereClause.sessionId = sessionId;
    }

    if (source) {
      whereClause.source = source;
    }

    if (status) {
      whereClause.status = status;
    }

    if (type) {
      whereClause.type = type;
    }

    if (label) {
      if (label === "no_label") {
        whereClause.labelIds = {
          isEmpty: true,
        };
      } else {
        whereClause.labelIds = {
          has: label,
        };
      }
    }

    // Add cursor condition for pagination
    if (cursor) {
      whereClause.createdAt = {
        lt: new Date(cursor),
      };
    }

    // Fetch Documents with simple pagination - no deduplication
    const [documents, totalCount] = await Promise.all([
      prisma.document.findMany({
        where: whereClause,
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
      }),
      prisma.document.count({
        where: whereClause,
      }),
    ]);

    // Check if there are more results for hasMore flag
    const hasMore = documents.length === limit && totalCount > limit;

    // Get the cursor for the next page (last item's createdAt)
    const nextCursor =
      documents.length > 0
        ? documents[documents.length - 1].createdAt.toISOString()
        : null;

    // Get document IDs for ingestion queue lookups
    const documentIds = documents
      .map((d) => d.sessionId)
      .filter(Boolean) as string[];

    // Fetch latest ingestion logs and counts in parallel for all documents
    const [latestLogs, queueCounts] =
      documentIds.length > 0
        ? await Promise.all([
          // Get latest log for each sessionId (document.id)
          prisma.ingestionQueue.findMany({
            where: {
              sessionId: { in: documentIds },
              workspaceId: user.Workspace.id,
            },
            select: {
              id: true,
              sessionId: true,
              status: true,
              createdAt: true,
              updatedAt: true,
              error: true,
            },
            orderBy: {
              createdAt: "desc",
            },
            distinct: ["sessionId"],
          }),
          // Get count for each sessionId
          prisma.ingestionQueue.groupBy({
            by: ["sessionId"],
            where: {
              sessionId: { in: documentIds },
              workspaceId: user.Workspace.id,
            },
            _count: {
              id: true,
            },
          }),
        ])
        : [[], []];

    // Create lookup maps for O(1) access
    const latestLogMap = new Map(latestLogs.map((log) => [log.sessionId, log]));
    const countMap = new Map(
      queueCounts.map((count) => [count.sessionId, count._count.id]),
    );

    // Augment documents with ingestion queue data
    const documentsWithQueueData = documents.map((doc) => ({
      ...doc,
      status: latestLogMap.get(doc.sessionId)?.status || null,
      error: latestLogMap.get(doc.sessionId)?.error || null,
      ingestionQueueCount: countMap.get(doc.sessionId) || 0,
    }));

    return json({
      documents: documentsWithQueueData,
      page,
      limit,
      hasMore,
      nextCursor, // Client uses this for next page instead of page number
      availableSources,
      totalCount,
    });
  },
);
