import { task } from "@trigger.dev/sdk/v3";
import {
  processAgentTurn,
  type RunAgentTurnPayload,
} from "~/jobs/conversation/run-agent-turn.logic";
import { initializeProvider } from "../utils/provider";

/**
 * Runs one agent's turn on an existing conversation after a mention has
 * reserved a placeholder row. Cancellation via `runs.cancel(id)` — invoked
 * by `dispatchMentions` when a fresh mention supersedes an in-flight turn.
 */
export const runAgentTurn = task({
  id: "run-agent-turn",
  maxDuration: 1800,
  run: async (payload: RunAgentTurnPayload) => {
    await initializeProvider();
    return await processAgentTurn(payload);
  },
});
