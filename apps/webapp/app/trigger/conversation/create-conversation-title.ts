import { task } from "@trigger.dev/sdk/v3";
import {
  processConversationTitleCreation,
  type CreateConversationTitlePayload,
} from "~/jobs/conversation/create-title.logic";
import { initializeProvider } from "../utils/provider";

export const createConversationTitle = task({
  id: "create-conversation-title",
  run: async (payload: CreateConversationTitlePayload) => {
    await initializeProvider();
    return await processConversationTitleCreation(payload);
  },
});
