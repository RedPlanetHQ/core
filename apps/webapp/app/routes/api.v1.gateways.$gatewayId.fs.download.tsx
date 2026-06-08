import { type LoaderFunctionArgs } from "@remix-run/node";
import path from "node:path";
import { prisma } from "~/db.server";
import { requireUser, getWorkspaceId } from "~/services/session.server";
import {
  contentTypeForFilename,
  downloadGatewayFile,
  GatewayDownloadError,
} from "~/services/gateway/file-download.server";

/**
 * GET /api/v1/gateways/:gatewayId/fs/download?path=<absolute>
 *
 * Session-gated attachment download for a file on the gateway. The
 * chunked transport lives in `services/gateway/file-download.server.ts`
 * so the public signed-URL route can share it.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { gatewayId } = params;
  if (!gatewayId) return new Response("Missing gatewayId", { status: 400 });

  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user.id,
    user.workspaceId,
  )) as string;

  const gw = await prisma.gateway.findFirst({
    where: { id: gatewayId, workspaceId },
    select: { id: true },
  });
  if (!gw) return new Response("Gateway not found", { status: 404 });

  const url = new URL(request.url);
  const target = url.searchParams.get("path");
  if (!target) return new Response("Missing path", { status: 400 });

  let result;
  try {
    result = await downloadGatewayFile(gatewayId, target);
  } catch (err) {
    if (err instanceof GatewayDownloadError) {
      return new Response(err.message, { status: err.status });
    }
    return new Response(err instanceof Error ? err.message : String(err), {
      status: 502,
    });
  }

  const filename = path.basename(target);
  // RFC 5987 filename* with UTF-8 — handles unicode filenames cleanly.
  return new Response(result.body, {
    status: 200,
    headers: {
      "Content-Type": contentTypeForFilename(filename),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(result.body.length),
      "Cache-Control": "no-store",
    },
  });
}
