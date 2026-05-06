import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridLoaderApiRoute,
  createLoaderApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import {
  getWidgetById,
  getWidgetBySlug,
  type WidgetRow,
} from "~/services/widgets/widget.server";

const ParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * GET /api/v1/widgets/:id
 *
 * Returns a single widget IR by uuid OR slug. The agent uses this to read a
 * widget for inspection/cloning; the chat-side renderer uses it to resolve a
 * `<core-widget id="..." />` tag.
 */
export const loader = createHybridLoaderApiRoute(
  {
    params: ParamsSchema,
    allowJWT: true,
    corsStrategy: "all",
    findResource: async (
      params,
      authentication,
    ): Promise<WidgetRow | undefined> => {
      const { workspaceId, userId } = authentication;
      if (!workspaceId || !userId) return undefined;

      const looksLikeUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          params.id,
        );
      const widget = looksLikeUuid
        ? await getWidgetById(params.id, workspaceId, userId)
        : await getWidgetBySlug(params.id, workspaceId, userId);
      return widget ?? undefined;
    },
  },
  async ({ resource: widget, authentication }) => {
    if (!widget) {
      return json({ error: "Widget not found" }, { status: 404 });
    }

    // For bundled widgets, the renderer needs the workspace's widget PAT
    // and the API base URL to inject into the loaded React bundle's render
    // context (mirrors the existing dashboard render path).
    let pat: string | null = null;
    let baseUrl: string | null = null;
    if (widget.engine === "BUNDLED") {
      const { getOrCreateWidgetPat } =
        await import("~/services/widgets.server");
      pat = await getOrCreateWidgetPat(
        authentication.workspaceId!,
        authentication.userId!,
      );
      baseUrl = process.env.APP_ORIGIN ?? null;
    }

    return json({
      widget: {
        id: widget.id,
        slug: widget.slug,
        name: widget.name,
        description: widget.description,
        icon: widget.icon,
        kind: widget.kind,
        engine: widget.engine,
        version: widget.version,
        // DECLARATIVE
        spec: widget.spec,
        state: widget.state,
        sourceSlug: widget.sourceSlug,
        // BUNDLED
        integrationAccountId: widget.integrationAccountId,
        bundledWidgetSlug: widget.bundledWidgetSlug,
        configValues: widget.configValues,
        bundled: widget.bundled,
        // Render-time tokens (BUNDLED only)
        pat,
        baseUrl,
      },
    });
  },
);
