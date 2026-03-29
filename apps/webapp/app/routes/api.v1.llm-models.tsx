import { json } from "@remix-run/node";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getAvailableModels } from "~/services/llm-provider.server";

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
  },
  async ({ authentication }) => {
    const models = await getAvailableModels(authentication.workspaceId as string | undefined);

    // Exclude embedding-only models (not useful for chat selection)
    const chatModels = models.filter(
      (m) => m.capabilities.length === 0 || m.capabilities.includes("chat"),
    );

    return json(
      chatModels.map((m) => ({
        id: `${m.provider.type}/${m.modelId}`,
        modelId: m.modelId,
        label: m.label,
        provider: m.provider.type,
        complexity: m.complexity,
        supportsBatch: m.supportsBatch,
        capabilities: m.capabilities,
        isDefault: m.isDefault,
      })),
    );
  },
);

export { loader };
