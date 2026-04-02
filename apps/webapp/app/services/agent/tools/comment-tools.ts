import { type Tool, tool } from "ai";
import { z } from "zod";
import { createButlerComment } from "~/services/butler-comment.server";
import { getHocuspocusRef, applyCommentMarkToYdoc } from "~/services/collab-scanner.server";

interface GetCommentToolsParams {
  workspaceId: string;
  /** Closed over — agent cannot pick a different page */
  pageId: string;
  conversationId?: string;
}

export function getCommentTools(params: GetCommentToolsParams): Record<string, Tool> {
  const { workspaceId, pageId, conversationId } = params;

  return {
    add_comment: tool({
      description:
        "Add a comment to the user's daily scratchpad, anchored to specific text. Use this to answer questions, provide information, or leave suggestions on what the user wrote.",
      inputSchema: z.object({
        selectedText: z
          .string()
          .describe(
            "The exact text from the page to anchor the comment to. Must be a verbatim substring of the page content.",
          ),
        content: z.string().describe("Your comment — concise and helpful."),
      }),
      execute: async ({ selectedText, content }) => {
        const comment = await createButlerComment(
          workspaceId,
          pageId,
          selectedText,
          content,
          conversationId,
        );

        // Apply mark directly into the live Yjs doc — syncs to all clients
        const liveDoc = getHocuspocusRef()?.documents.get(pageId);
        if (liveDoc) {
          applyCommentMarkToYdoc(liveDoc, selectedText, comment.id);
        }

        return `Comment added (id: ${comment.id}) on "${selectedText.slice(0, 50)}${selectedText.length > 50 ? "..." : ""}"`;
      },
    }),
  };
}
