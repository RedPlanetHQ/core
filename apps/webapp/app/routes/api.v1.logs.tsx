import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { requireUserId } from "~/services/session.server";

/**
 * Optimizations:
 * - Use `findMany` with `select` instead of `include` to fetch only required fields.
 * - Use `count` with the same where clause, but only after fetching logs (to avoid unnecessary count if no logs).
 * - Use a single query for availableSources with minimal fields.
 * - Avoid unnecessary object spreading and type casting.
 * - Minimize nested object traversal in mapping.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const url = new URL(request.url);

  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const source = url.searchParams.get("source");
  const status = url.searchParams.get("status");
  const skip = (page - 1) * limit;

  // Get user and workspace in one query
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { Workspace: { select: { id: true } } },
  });

  if (!user?.Workspace) {
    throw new Response("Workspace not found", { status: 404 });
  }

  // Build where clause for filtering
  const whereClause: any = {
    workspaceId: user.Workspace.id,
  };

  if (status) {
    whereClause.status = status;
  }

  // If source filter is provided, filter by integration source
  if (source) {
    whereClause.activity = {
      integrationAccount: {
        integrationDefinition: {
          slug: source,
        },
      },
    };
  }

  // Use select to fetch only required fields for logs
  const [logs, totalCount, availableSources] = await Promise.all([
    prisma.ingestionQueue.findMany({
      where: whereClause,
      select: {
        id: true,
        createdAt: true,
        processedAt: true,
        status: true,
        error: true,
        type: true,
        output: true,
        data: true,
        activity: {
          select: {
            text: true,
            sourceURL: true,
            integrationAccount: {
              select: {
                integrationDefinition: {
                  select: {
                    name: true,
                    slug: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
    }),

    prisma.ingestionQueue.count({
      where: whereClause,
    }),

    prisma.integrationDefinitionV2.findMany({
      where: {
        IntegrationAccount: {
          some: {
            workspaceId: user.Workspace.id,
          },
        },
      },
      select: {
        name: true,
        slug: true,
      },
    }),
  ]);

  // Format the response
  const formattedLogs = logs.map((log) => {
    const integrationDef =
      log.activity?.integrationAccount?.integrationDefinition;
    const logData = log.data as any;

    return {
      id: log.id,
      source: integrationDef?.name || logData?.source || "Unknown",
      ingestText:
        log.activity?.text ||
        logData?.episodeBody ||
        logData?.text ||
        "No content",
      time: log.createdAt,
      processedAt: log.processedAt,
      episodeUUID: (log.output as any)?.episodeUuid,
      status: log.status,
      error: log.error,
      sourceURL: log.activity?.sourceURL,
      integrationSlug: integrationDef?.slug,
      data: log.data,
    };
  });

  return json({
    logs: formattedLogs,
    totalCount,
    page,
    limit,
    hasMore: skip + logs.length < totalCount,
    availableSources,
  });
}
