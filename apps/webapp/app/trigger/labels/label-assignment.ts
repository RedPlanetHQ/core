import { task } from "@trigger.dev/sdk";
import {
  processLabelAssignment,
  type LabelAssignmentPayload,
} from "~/jobs/labels/label-assignment.logic";

// Register the Trigger.dev task for label assignment
export const labelAssignmentTask = task({
  id: "label-assignment",
  machine: "small-1x",
  run: async (payload: LabelAssignmentPayload) => {
    return await processLabelAssignment(payload);
  },
});
