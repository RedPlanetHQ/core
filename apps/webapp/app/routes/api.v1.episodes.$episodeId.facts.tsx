import { type LoaderFunctionArgs, json } from "@remix-run/node";

import { getEpisodeFacts } from "~/services/episodeFacts.server";
import { requireUser } from "~/services/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const user = await requireUser(request);
    const { episodeId } = params;

    if (!episodeId) {
      return json(
        { success: false, error: "Episode ID is required" },
        { status: 400 },
      );
    }

    const result = await getEpisodeFacts(episodeId, user.id);

    return json(result);
  } catch (error) {
    console.error("Error in episodes facts API:", error);
    return json(
      { success: false, error: "Internal server error", facts: [] },
      { status: 500 },
    );
  }
}
