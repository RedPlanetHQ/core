import { type LoaderFunctionArgs, json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { requireUserId } from "~/services/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const logId = params.logId;

  // Get user and workspace in one query
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { Workspace: { select: { id: true } } },
  });

  if (!user?.Workspace) {
    throw new Response("Workspace not found", { status: 404 });
  }

  // Fetch the specific log by logId
  const log = await prisma.ingestionQueue.findUnique({
    where: { id: logId },
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
  });

  if (!log) {
    throw new Response("Log not found", { status: 404 });
  }

  // Format the response
  const integrationDef =
    log.activity?.integrationAccount?.integrationDefinition;
  const logData = log.data as any;

  const formattedLog = {
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

  return json({ log: formattedLog });
}
