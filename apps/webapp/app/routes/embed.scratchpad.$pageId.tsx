import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";

import { generateCollabToken } from "~/services/collab-token.server";
import { authenticatePersonalAccessToken } from "~/services/personalAccessToken.server";
import { getPageById } from "~/services/page.server";
import { getWorkspaceById } from "~/models/workspace.server";
import {
  getOrCreateWidgetPat,
  getWidgetOptions,
} from "~/services/widgets.server";
import { ScratchpadEmbedHost } from "~/components/editor/scratchpad-embed-host.client";
import { WidgetContext } from "~/components/editor/extensions/widget-node-extension";

// Chromeless embed used by the mobile app's <WebView>. Auth comes from a
// PAT in the query string (`?token=…`) — convenient for the WebView since
// it can't easily set request headers — and the response is just the
// PageEditor on a transparent background. Hocuspocus collab works exactly
// like the desktop daily page.

export const meta: MetaFunction = () => [
  { title: "Scratchpad" },
  {
    name: "viewport",
    content:
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
  },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const pat = url.searchParams.get("token");
  if (!pat) return json({ error: "missing token" }, { status: 401 });

  const auth = await authenticatePersonalAccessToken(pat);
  if (!auth) return json({ error: "invalid token" }, { status: 401 });

  const pageId = params.pageId;
  if (!pageId) return json({ error: "missing pageId" }, { status: 400 });

  const page = await getPageById(pageId);
  if (!page || page.workspaceId !== auth.workspaceId) {
    return json({ error: "page not found" }, { status: 404 });
  }

  const workspace = auth.workspaceId
    ? await getWorkspaceById(auth.workspaceId)
    : null;

  const [widgetOptions, widgetPat] = await Promise.all([
    getWidgetOptions(auth.userId, auth.workspaceId as string).catch(() => []),
    getOrCreateWidgetPat(auth.workspaceId as string, auth.userId).catch(
      () => null,
    ),
  ]);

  return json({
    pageId,
    butlerName: workspace?.name ?? "butler",
    collabToken: generateCollabToken(
      auth.workspaceId as string,
      auth.userId,
    ),
    widgetOptions,
    widgetPat,
    baseUrl: url.origin,
  });
}

// Mobile-friendly type scale: bumps prose-sm sizes so the editor reads
// well on a phone. Scoped to the embed route only.
const EMBED_TYPE_OVERRIDES = `
  .scratchpad-embed .tiptap {
    font-size: 17px;
    line-height: 1.55;
  }
  .scratchpad-embed .tiptap p,
  .scratchpad-embed .tiptap li {
    font-size: 17px;
    line-height: 1.55;
  }
  .scratchpad-embed .tiptap h1 { font-size: 26px; line-height: 1.3; }
  .scratchpad-embed .tiptap h2 { font-size: 22px; line-height: 1.3; }
  .scratchpad-embed .tiptap h3 { font-size: 19px; line-height: 1.35; }
  .scratchpad-embed .tiptap pre,
  .scratchpad-embed .tiptap code { font-size: 15px; }
`;

export default function ScratchpadEmbed() {
  const data = useLoaderData<typeof loader>() as {
    pageId?: string;
    butlerName?: string;
    collabToken?: string;
    widgetOptions?: unknown[];
    widgetPat?: string | null;
    baseUrl?: string;
    error?: string;
  };

  if (data.error || !data.pageId || !data.collabToken) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        {data.error ?? "Unable to load scratchpad."}
      </div>
    );
  }

  const widgetCtx =
    data.widgetPat && data.baseUrl
      ? {
          pat: data.widgetPat,
          baseUrl: data.baseUrl,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          widgetOptions: (data.widgetOptions ?? []) as any,
        }
      : null;

  const editor = (
    <ClientOnly fallback={null}>
      {() => (
        <ScratchpadEmbedHost
          pageId={data.pageId!}
          collabToken={data.collabToken!}
          butlerName={data.butlerName ?? "butler"}
        />
      )}
    </ClientOnly>
  );

  return (
    <div className="scratchpad-embed bg-background min-h-screen w-full px-4 pt-4 pb-12">
      <style dangerouslySetInnerHTML={{ __html: EMBED_TYPE_OVERRIDES }} />
      {widgetCtx ? (
        <WidgetContext.Provider value={widgetCtx}>
          {editor}
        </WidgetContext.Provider>
      ) : (
        editor
      )}
    </div>
  );
}
