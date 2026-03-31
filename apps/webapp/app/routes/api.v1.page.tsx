import { json } from "@remix-run/node";
import { z } from "zod";
import { createHybridLoaderApiRoute } from "~/services/routeBuilders/apiBuilder.server";
import { findOrCreateDailyPage } from "~/services/page.server";

const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    findResource: async () => 1,
    corsStrategy: "all",
    searchParams: z.object({
      date: z.string(),
    }),
  },
  async ({ authentication, searchParams }) => {
    const date = new Date(searchParams!.date);
    if (isNaN(date.getTime())) {
      return json({ error: "Invalid date" }, { status: 400 });
    }

    const page = await findOrCreateDailyPage(
      authentication.workspaceId as string,
      authentication.userId,
      date,
    );

    return json(page);
  },
);

export { loader };
