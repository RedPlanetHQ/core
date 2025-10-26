import { task } from "@trigger.dev/sdk/v3";
import {
  processConversationTitleCreation,
  type CreateConversationTitlePayload,
} from "~/jobs/conversation/create-title.logic";

export const createConversationTitle = task({
  id: "create-conversation-title",
  run: async (payload: CreateConversationTitlePayload) => {
    return await processConversationTitleCreation(payload);
  },
});
