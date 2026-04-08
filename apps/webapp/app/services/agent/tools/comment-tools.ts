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

/** Resolve stored relative positions → ancestor paragraph/heading XmlElement nodes */
function buildCommentedNodeSet(
  doc: Y.Doc,
  comments: { relativeStart: unknown }[],
): WeakSet<Y.XmlElement> {
  const set = new WeakSet<Y.XmlElement>();
  const blockNodes = new Set(["paragraph", "heading", "codeBlock", "blockquote"]);

  for (const comment of comments) {
    if (!comment.relativeStart) continue;
    try {
      const relPos = Y.createRelativePositionFromJSON(
        comment.relativeStart as Parameters<typeof Y.createRelativePositionFromJSON>[0],
      );
      const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, doc);
      if (!absPos) continue;

      // Walk up from the XmlText to find the containing block element
      let node: Y.AbstractType<any> | null = absPos.type as Y.AbstractType<any>;
      while (node) {
        if (node instanceof Y.XmlElement && blockNodes.has(node.nodeName)) {
          set.add(node);
          break;
        }
        node = (node as any).parent ?? null;
      }
    } catch {
      // Ignore malformed / stale positions
    }
  }

  return set;
}

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

/** Walk the Yjs tree and serialize to an annotated XML string.
 *  Nodes in `commentedNodes` get data-commented="true" so the agent skips them. */
export function buildAnnotatedPageXml(
  doc: Y.Doc,
  comments: { relativeStart: unknown }[],
): string {
  const fragment = doc.getXmlFragment("default");
  const commentedNodes = buildCommentedNodeSet(doc, comments);

  const leafNodes = new Set(["paragraph", "heading", "codeBlock", "blockquote"]);
  const listNodes = new Set(["bulletList", "orderedList", "taskList"]);
  const itemNodes = new Set(["listItem", "taskItem"]);

  function serializeNode(node: Y.XmlElement, indent: string): string {
    const name = node.nodeName;
    const childIndent = indent + "  ";

    if (leafNodes.has(name)) {
      const text = collectText(node);
      if (!text) return "";
      const attr = commentedNodes.has(node) ? ` data-commented="true"` : "";
      return `${indent}<${name}${attr}>${text}</${name}>`;
    }

    if (listNodes.has(name)) {
      const children: string[] = [];
      node.forEach((child) => {
        if (child instanceof Y.XmlElement && itemNodes.has(child.nodeName)) {
          const s = serializeNode(child, childIndent);
          if (s) children.push(s);
        }
      });
      if (!children.length) return "";
      return `${indent}<${name}>\n${children.join("\n")}\n${indent}</${name}>`;
    }

    if (itemNodes.has(name)) {
      const children: string[] = [];
      node.forEach((child) => {
        if (child instanceof Y.XmlElement) {
          const s = serializeNode(child, childIndent);
          if (s) children.push(s);
        }
      });
      if (children.length) {
        return `${indent}<${name}>\n${children.join("\n")}\n${indent}</${name}>`;
      }
      const text = collectText(node);
      if (!text) return "";
      return `${indent}<${name}>${text}</${name}>`;
    }

    // Generic fallback
    const text = collectText(node);
    if (!text) return "";
    const attr = commentedNodes.has(node) ? ` data-commented="true"` : "";
    return `${indent}<${name}${attr}>${text}</${name}>`;
  }

  const lines: string[] = [];
  fragment.forEach((child) => {
    if (child instanceof Y.XmlElement) {
      const s = serializeNode(child, "");
      if (s) lines.push(s);
    }
  });
  return lines.join("\n");
}

export function getCommentTools(params: GetCommentToolsParams): Record<string, Tool> {
  const { workspaceId, userId, pageId, conversationId } = params;

  return {
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
        "Add a comment anchored to a specific piece of the scratchpad and dispatch the intent to the main agent. Copy selectedText verbatim from the XML page content.",
      inputSchema: z.object({
        selectedText: z
          .string()
          .describe(
            "The exact text to anchor the comment on, copied verbatim from the page content XML.",
          ),
        content: z.string().describe("Your comment — concise and helpful."),
        intent: z
          .string()
          .describe(
            "The actionable intent to pass to the main agent. Must be self-contained and unambiguous.",
          ),
      }),
      execute: async ({ selectedText, content, intent }) => {
        // Dedup guard — prevent multiple comments on the same text across scans
        const duplicate = await prisma.butlerComment.findFirst({
          where: { pageId, resolved: false, selectedText: selectedText.trim() },
        });
        if (duplicate) return "Already commented on this text — skipping.";

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

        // Save the comment (createButlerComment resolves position internally)
        const comment = await createButlerComment(
          workspaceId,
          pageId,
          selectedText.trim(),
          content,
          convId,
        );

        // If the text wasn't found verbatim in the document, clean up and ask the agent to retry
        if (!comment.relativeStart) {
          await prisma.butlerComment.delete({ where: { id: comment.id } });
          return `Could not anchor comment: "${selectedText.slice(0, 60)}" not found verbatim in document. Use a shorter phrase copied exactly from the XML and try again.`;
        }

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
