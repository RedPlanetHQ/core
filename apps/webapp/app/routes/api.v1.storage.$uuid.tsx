import { z } from "zod";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { getFileFromS3 } from "~/lib/storage.server";

const ParamsSchema = z.object({
  uuid: z.string().uuid("Invalid UUID format"),
});

const loader = createHybridLoaderApiRoute(
  {
    params: ParamsSchema,
    corsStrategy: "all",
    findResource: async (params) => {
      // Return the UUID as the resource
      return params?.uuid || null;
    },
  },
  async ({ params, authentication }) => {
    if (!params?.uuid) {
      return new Response("UUID not provided", { status: 400 });
    }

    try {
      const fileResponse = await getFileFromS3(
        params.uuid,
        authentication.userId,
      );
      return fileResponse;
    } catch (error) {
      console.error("File retrieval error:", error);
      return new Response("File not found", { status: 404 });
    }
  },
);

export { loader };
