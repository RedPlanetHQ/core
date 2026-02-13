import { queue, task } from "@trigger.dev/sdk";
import {
  processLabelAssignment,
  type LabelAssignmentPayload,
} from "~/jobs/labels/label-assignment.logic";
import { initializeProvider } from "../utils/provider";

const labelAssigmentQueue = queue({
  name: "label-assignment-queue",
  concurrencyLimit: 10,
});

// Register the Trigger.dev task for label assignment
export const labelAssignmentTask = task({
  id: "label-assignment",
  queue: labelAssigmentQueue,
  machine: "small-1x",
  run: async (payload: LabelAssignmentPayload) => {
    await initializeProvider();
    return await processLabelAssignment(payload);
  },
});
