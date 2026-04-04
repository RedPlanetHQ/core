import { type Tool, tool } from "ai";
import { z } from "zod";
import * as Y from "yjs";
import { prisma } from "~/db.server";
import { createButlerComment } from "~/services/butler-comment.server";
import { searchMemoryWithAgent } from "~/services/agent/memory";
import { createConversation } from "~/services/conversation.server";
import { noStreamProcess } from "~/services/agent/no-stream-process";
import { logger } from "~/services/logger.service";

interface GetCommentToolsParams {
  workspaceId: string;
  userId: string;
  /** Closed over — agent cannot pick a different page */
  pageId: string;
  /** If provided, reuse this conversation. Otherwise add_comment creates one. */
  conversationId?: string;
}

/** Walk a Yjs tree and emit one entry per text-bearing leaf, handling lists */
export function extractPageLines(
  fragment: Y.XmlFragment,
): { lineNumber: number; text: string }[] {
  const lines: { lineNumber: number; text: string }[] = [];
  let lineNumber = 1;

  function collectText(node: Y.XmlElement | Y.XmlFragment): string {
    const parts: string[] = [];
    node.forEach((child) => {
      if (child instanceof Y.XmlText) {
        parts.push(child.toString());
      } else if (child instanceof Y.XmlElement) {
        if (child.nodeName === "mention") {
          parts.push(`@${child.getAttribute("label") ?? ""}`);
        } else {
          parts.push(collectText(child));
        }
      }
    });
    return parts.join("").trim();
  }

  const listNodes = new Set(["bulletList", "orderedList", "taskList"]);
  const itemNodes = new Set(["listItem", "taskItem"]);

  fragment.forEach((child) => {
    if (!(child instanceof Y.XmlElement)) return;

    if (listNodes.has(child.nodeName)) {
      child.forEach((listChild) => {
        if (listChild instanceof Y.XmlElement && itemNodes.has(listChild.nodeName)) {
          const text = collectText(listChild);
          if (text) {
            lines.push({ lineNumber, text });
            lineNumber++;
          }
        }
      });
    } else {
      const text = collectText(child);
      if (text) {
        lines.push({ lineNumber, text });
        lineNumber++;
      }
    }
  });

  return lines;
}

export function getCommentTools(params: GetCommentToolsParams): Record<string, Tool> {
  const { workspaceId, userId, pageId, conversationId } = params;

  return {
    get_my_comments: tool({
      description:
        "Get the list of lines you have already commented on (unresolved). Call this before add_comment to avoid re-engaging the same content.",
      inputSchema: z.object({}),
      execute: async () => {
        const comments = await prisma.butlerComment.findMany({
          where: { pageId, resolved: false },
          select: { selectedText: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        });

        if (comments.length === 0) return "No existing comments.";

        return comments
          .map((c) => `- "${c.selectedText.slice(0, 80)}"`)
          .join("\n");
      },
    }),

    search_memory: tool({
      description:
        "Search the user's memory for relevant context — past decisions, preferences, people, projects. Use this when scratchpad content references something you need more context on.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Natural language query describing what context you need."),
      }),
      execute: async ({ query }) => {
        return searchMemoryWithAgent(query, userId, workspaceId, "daily");
      },
    }),

    add_comment: tool({
      description:
        "Add a comment anchored to a specific line of the scratchpad and dispatch the intent to the main agent for execution. Use the lineNumber from the page content in your context and copy the text verbatim as selectedText.",
      inputSchema: z.object({
        lineNumber: z
          .number()
          .int()
          .describe("The line number from the page content."),
        selectedText: z
          .string()
          .describe(
            "The exact text of the line, copied verbatim from the page content. Used to anchor the comment precisely.",
          ),
        content: z.string().describe("Your comment — concise and helpful."),
        intent: z
          .string()
          .describe(
            "The actionable intent to pass to the main agent. E.g. 'Set a reminder for 6pm to call mom' or 'Draft a follow-up email to the investor about the check-in'.",
          ),
      }),
      execute: async ({ lineNumber, selectedText, content, intent }) => {
        // Verify/correct selectedText using lineNumber as the source of truth
        const page = await prisma.page.findUnique({
          where: { id: pageId },
          select: { descriptionBinary: true },
        });

        if (page?.descriptionBinary) {
          const doc = new Y.Doc();
          Y.applyUpdate(doc, new Uint8Array(page.descriptionBinary));
          const fragment = doc.getXmlFragment("default");
          const lines = extractPageLines(fragment);
          const lineAtNumber = lines.find((l) => l.lineNumber === lineNumber);
          if (lineAtNumber) {
            selectedText = lineAtNumber.text;
          }
        }

        // Use existing conversationId or create a new one
        let convId = conversationId;
        if (!convId) {
          const result = await createConversation(workspaceId, userId, {
            message: intent,
            source: "daily",
            parts: [{ text: intent, type: "text" }],
          });
          convId = result.conversationId;
        }

        // Save the comment with the conversationId (used for UI marks)
        const comment = await createButlerComment(
          workspaceId,
          pageId,
          selectedText,
          content,
          convId,
        );

        // Fire the core agent to do the actual work
        noStreamProcess(
          {
            id: convId,
            message: {
              parts: [{ text: intent, type: "text" }],
              role: "user",
            },
            source: "daily",
            scratchpadPageId: pageId,
            interactive: true,
          },
          userId,
          workspaceId,
        ).catch((err) => {
          logger.error(
            `[scratchpad] Core agent failed for comment=${comment.id}`,
            { err },
          );
        });

        return `Comment added (id: ${comment.id}, conversationId: ${convId}) on "${selectedText.slice(0, 50)}${selectedText.length > 50 ? "..." : ""}" — main agent dispatched.`;
      },
    }),
  };
}
