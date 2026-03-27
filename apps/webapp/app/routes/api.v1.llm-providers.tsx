import { json } from "@remix-run/node";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getProviders } from "~/services/llm-provider.server";

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
  },
  async () => {
    const providers = await getProviders();
    return json(providers);
  },
);

export { loader };
