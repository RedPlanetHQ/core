import { task } from "@trigger.dev/sdk";
import {
  processTitleGeneration,
  type TitleGenerationPayload,
} from "~/jobs/titles/title-generation.logic";

// Register the Trigger.dev task for title generation
export const titleGenerationTask = task({
  id: "title-generation",
  machine: "small-1x",
  run: async (payload: TitleGenerationPayload) => {
    return await processTitleGeneration(payload);
  },
});
