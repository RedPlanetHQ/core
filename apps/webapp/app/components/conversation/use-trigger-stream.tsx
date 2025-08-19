import { useRealtimeRunWithStreams } from "@trigger.dev/react-hooks";
import React from "react";

const getTriggerAPIURL = (apiURL?: string) => {
  return (
    (apiURL?.includes("trigger-webapp") ? "http://localhost:8030" : apiURL) ??
    "https://trigger.heysol.ai"
  );
};

export const useTriggerStream = (
  runId: string,
  token: string,
  apiURL?: string,
) => {
  // Need to fix this later
  const baseURL = React.useMemo(() => getTriggerAPIURL(apiURL), [apiURL]);

  const { error, streams, run } = useRealtimeRunWithStreams(runId, {
    accessToken: token,
    baseURL, // Optional if you are using a self-hosted Trigger.dev instance
  });

  const isEnd = React.useMemo(() => {
    if (error) {
      return true;
    }

    if (
      run &&
      [
        "COMPLETED",
        "CANCELED",
        "FAILED",
        "CRASHED",
        "INTERRUPTED",
        "SYSTEM_FAILURE",
        "EXPIRED",
        "TIMED_OUT",
      ].includes(run?.status)
    ) {
      return true;
    }

    const hasStreamEnd =
      streams.messages &&
      streams.messages.filter((item) => {
        // Check if the item has a type that includes 'MESSAGE_' and is not empty
        return item.type?.includes("STREAM_END");
      });

    if (hasStreamEnd && hasStreamEnd.length > 0) {
      return true;
    }

    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, error, streams.messages?.length]);

  const message = React.useMemo(() => {
    if (!streams?.messages) {
      return "";
    }

    // Filter and combine all message chunks
    return streams.messages
      .filter((item) => {
        // Check if the item has a type that includes 'MESSAGE_' and is not empty
        return item.type?.includes("MESSAGE_");
      })
      .map((item) => item.message)
      .join("");

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streams.messages?.length]);

  // const actionMessages = React.useMemo(() => {
  //   if (!streams?.messages) {
  //     return {};
  //   }

  //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
  //   const messages: Record<string, { isStreaming: boolean; content: any[] }> =
  //     {};

  //   streams.messages.forEach((item) => {
  //     if (item.type?.includes("SKILL_")) {
  //       try {
  //         const parsed = JSON.parse(item.message);
  //         const skillId = parsed.skillId;

  //         if (!messages[skillId]) {
  //           messages[skillId] = { isStreaming: true, content: [] };
  //         }

  //         if (item.type === "SKILL_END") {
  //           messages[skillId].isStreaming = false;
  //         }

  //         messages[skillId].content.push(parsed);
  //       } catch (e) {
  //         console.error("Failed to parse message:", e);
  //       }
  //     }
  //   });

  //   return messages;

  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [streams.messages?.length]);

  return { isEnd, message, actionMessages: [] };
};
