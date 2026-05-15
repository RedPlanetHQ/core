import { queue, task } from "@trigger.dev/sdk/v3";
import {
  processCodingDescriptionUpdate,
  type CodingDescriptionUpdatePayload,
} from "~/jobs/coding/description-update.logic";
import { initializeProvider } from "../utils/provider";

export const codingDescriptionUpdateQueue = queue({
  name: "coding-description-update-queue",
  concurrencyLimit: 5,
});

export const codingDescriptionUpdateTask = task({
  id: "coding-description-update",
  queue: codingDescriptionUpdateQueue,
  run: async (payload: CodingDescriptionUpdatePayload) => {
    await initializeProvider();
    return await processCodingDescriptionUpdate(payload);
  },
});
