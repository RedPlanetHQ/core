import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import {
  setWorkspaceApiKey,
  deleteWorkspaceApiKey,
  getWorkspaceKeyStatus,
  isSupportedProvider,
} from "~/services/byok.server";
import { getProviders } from "~/services/llm-provider.server";

// ---------------------------------------------------------------------------
// GET /api/v1/byok — list BYOK key status per provider
// ---------------------------------------------------------------------------

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
  },
  async ({ authentication }) => {
    if (!authentication.workspaceId) {
      return json({ error: "Workspace not found" }, { status: 404 });
    }

    const [keyStatuses, globalProviders] = await Promise.all([
      getWorkspaceKeyStatus(authentication.workspaceId),
      getProviders(),
    ]);

    const byokMap = new Map(
      keyStatuses.map((s) => [s.providerType, s]),
    );

    // Build response: all global providers + BYOK status
    const providers = globalProviders.map((p) => ({
      providerType: p.type,
      name: p.name,
      hasKey: byokMap.has(p.type),
      ...(byokMap.has(p.type) && {
        createdAt: byokMap.get(p.type)!.createdAt,
        updatedAt: byokMap.get(p.type)!.updatedAt,
      }),
    }));

    // Also include BYOK providers not in global (edge case: no platform key)
    for (const status of keyStatuses) {
      if (!providers.some((p) => p.providerType === status.providerType)) {
        providers.push({
          providerType: status.providerType,
          name: status.providerType,
          hasKey: true,
          createdAt: status.createdAt,
          updatedAt: status.updatedAt,
        });
      }
    }

    return json(providers);
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/byok — set a BYOK key
// DELETE /api/v1/byok — remove a BYOK key
// ---------------------------------------------------------------------------

const SetKeyBody = z.object({
  providerType: z.enum(["openai", "anthropic", "google"]),
  apiKey: z.string().min(1, "API key is required"),
  baseUrl: z.string().optional(),
});

const DeleteKeyBody = z.object({
  providerType: z.enum(["openai", "anthropic", "google"]),
});

const { action } = createHybridActionApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
  },
  async ({ authentication, request }) => {
    if (!authentication.workspaceId) {
      return json({ error: "Workspace not found" }, { status: 404 });
    }

    const method = request.method.toUpperCase();
    const rawBody = await request.json();

    if (method === "DELETE") {
      const parsed = DeleteKeyBody.safeParse(rawBody);
      if (!parsed.success) {
        return json(
          { error: "Invalid request", details: parsed.error.flatten() },
          { status: 400 },
        );
      }

      await deleteWorkspaceApiKey(
        authentication.workspaceId,
        parsed.data.providerType,
      );

      return json({ success: true, providerType: parsed.data.providerType });
    }

    // Default: POST — set key
    const parsed = SetKeyBody.safeParse(rawBody);
    if (!parsed.success) {
      return json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await setWorkspaceApiKey(
      authentication.workspaceId,
      parsed.data.providerType,
      parsed.data.apiKey,
      parsed.data.baseUrl,
    );

    return json({ success: true, providerType: parsed.data.providerType });
  },
);

export { loader, action };
