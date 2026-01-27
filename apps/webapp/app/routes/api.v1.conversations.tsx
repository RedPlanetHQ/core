import { json } from "@remix-run/node";

import {
  getConversationsList,
  GetConversationsListSchema,
} from "~/services/conversation.server";
import { requireUser } from "~/services/session.server";

export const loader = async ({ request }: { request: Request }) => {
  // Authenticate the request (allow JWT)
  const user = await requireUser(request);

  // Parse search params using the schema
  const url = new URL(request.url);
  const searchParamsObj: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    searchParamsObj[key] = value;
  });
  const parseResult = GetConversationsListSchema.safeParse(searchParamsObj);
  if (!parseResult.success) {
    return json(
      { error: "Invalid search parameters", details: parseResult.error.errors },
      { status: 400 },
    );
  }
  const searchParams = parseResult.data;



  if (!user.workspaceId) {
    return json({ error: "No workspace found" }, { status: 404 });
  }

  const result = await getConversationsList(
    user.workspaceId,
    user.id,
    searchParams || {},
  );

  return json(result);
};
