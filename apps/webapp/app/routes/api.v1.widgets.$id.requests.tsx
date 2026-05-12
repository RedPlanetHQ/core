import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { runWidgetRequests } from "~/services/widgets/run-requests";
import {
  getWidgetById,
  getWidgetBySlug,
  type WidgetRow,
} from "~/services/widgets/widget.server";

const ParamsSchema = z.object({
  id: z.string().min(1),
});

const PostBodySchema = z.object({
  /** True to bypass cache and re-execute. Defaults to true on POST. */
  force: z.boolean().optional(),
  /**
   * Optional list of request ids to run. When provided, only those execute
   * (the runtime calls with this when an action's `runRequest` op fires for
   * a single request — typically a mutation like send_email or create_issue).
   */
  requestIds: z.array(z.string()).optional(),
  /**
   * Action-payload scope forwarded from the dispatcher's `runRequest` op.
   * Lets request `params` templated as `{{args.title}}` / `{{event.values}}`
   * resolve against the originating Form/Button payload. Untrusted —
   * never use these to override authentication or widget identity.
   */
  args: z.record(z.string(), z.unknown()).optional(),
  event: z.record(z.string(), z.unknown()).optional(),
  /**
   * Config overrides for this render — merged on top of `ir.config[].default`
   * before evaluating templates. Set by the chat tag (`<core-widget
   * config='{...}' />`) or the daily-grid override layer. Without this, a
   * widget that relies on `{{$config.*}}` would render against the IR's
   * defaults and the displayed config wouldn't match the fetched data.
   */
  config: z.record(z.string(), z.unknown()).optional(),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findWidget(
  id: string,
  workspaceId: string,
  userId: string,
): Promise<WidgetRow | undefined> {
  const widget = UUID_RE.test(id)
    ? await getWidgetById(id, workspaceId, userId)
    : await getWidgetBySlug(id, workspaceId, userId);
  return widget ?? undefined;
}

/**
 * GET /api/v1/widgets/:id/requests
 *
 * Runs the widget's IR requests honoring the per-widget cache. Returns
 * `{ results, errors, cacheHit, cacheReason, expiresAt }`.
 */
export const loader = createHybridLoaderApiRoute(
  {
    params: ParamsSchema,
    allowJWT: true,
    corsStrategy: "all",
    findResource: async (params, authentication) => {
      const { workspaceId, userId } = authentication;
      if (!workspaceId || !userId) return undefined;
      return findWidget(params.id, workspaceId, userId);
    },
  },
  async ({ resource: widget, authentication }) => {
    if (!widget) {
      return json({ error: "Widget not found" }, { status: 404 });
    }
    const result = await runWidgetRequests({
      widgetId: widget.id,
      workspaceId: authentication.workspaceId!,
      userId: authentication.userId!,
      force: false,
    });
    return json(result);
  },
);

/**
 * POST /api/v1/widgets/:id/requests
 *
 * Force-refresh: bypasses cache and re-executes. Body: `{ force?: boolean }`
 * — defaults to true here since POST implies "run now". Used by the runtime's
 * `runRequest` action and by user-initiated "Refresh" buttons.
 */
const { action } = createHybridActionApiRoute(
  {
    params: ParamsSchema,
    body: PostBodySchema,
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ params, body, authentication }) => {
    const { workspaceId, userId } = authentication;
    if (!workspaceId || !userId) {
      return json({ error: "Unauthenticated" }, { status: 401 });
    }
    const widget = await findWidget(params.id, workspaceId, userId);
    if (!widget) return json({ error: "Widget not found" }, { status: 404 });

    const result = await runWidgetRequests({
      widgetId: widget.id,
      workspaceId,
      userId,
      force: body.force !== false, // POST defaults to force unless explicitly false
      requestIds: body.requestIds,
      args: body.args,
      event: body.event,
      configOverride: body.config,
    });
    return json(result);
  },
);

export { action };
