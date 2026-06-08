import { type LoaderFunctionArgs } from "@remix-run/node";
import path from "node:path";
import {
  contentTypeForFilename,
  downloadGatewayFile,
  GatewayDownloadError,
} from "~/services/gateway/file-download.server";
import { verifyFileToken } from "~/services/gateway/file-signed-url.server";

/**
 * GET /api/v1/fs/signed/:token
 *
 * PUBLIC route — no session check. The token is the auth: HMAC-signed
 * over (workspaceId, gatewayId, path, exp) with our SESSION_SECRET.
 * Verification fails on bad signature, expired, or malformed tokens.
 *
 * Used so external viewers that can't carry the session cookie
 * (Microsoft Office Online Viewer for PPTX/DOCX/XLSX) can fetch the
 * file. The token must be minted via `POST /fs/signed-url` by an
 * authenticated session first.
 *
 * Response is the file body inline (not `attachment`) — viewers
 * embed it, browsers preview it. Permissive CORS so Office Online's
 * cross-origin iframe can read.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { token } = params;
  if (!token) return new Response("Missing token", { status: 400 });

  const verified = verifyFileToken(token);
  if (!verified) {
    return new Response("Invalid or expired signed URL", { status: 401 });
  }

  let result;
  try {
    result = await downloadGatewayFile(verified.gatewayId, verified.path);
  } catch (err) {
    if (err instanceof GatewayDownloadError) {
      return new Response(err.message, { status: err.status });
    }
    return new Response(err instanceof Error ? err.message : String(err), {
      status: 502,
    });
  }

  const filename = path.basename(verified.path);
  return new Response(result.body, {
    status: 200,
    headers: {
      "Content-Type": contentTypeForFilename(filename),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(result.body.length),
      "Cache-Control": "private, max-age=300",
      // Permit cross-origin embedded viewers (e.g. Microsoft Office
      // Online) to fetch the bytes.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
