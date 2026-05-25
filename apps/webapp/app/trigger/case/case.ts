import { queue, task } from "@trigger.dev/sdk";
import { processCase, type CasePayload } from "~/jobs/case/case.logic";
import { initializeProvider } from "../utils/provider";

const caseQueueDef = queue({
  name: "case-queue",
  concurrencyLimit: 5,
});

export const caseTask = task({
  id: "case",
  queue: caseQueueDef,
  run: async (payload: CasePayload) => {
    await initializeProvider();
    return await processCase(payload);
  },
});
