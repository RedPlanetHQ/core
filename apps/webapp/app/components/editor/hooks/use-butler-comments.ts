import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import * as Y from "yjs";

interface ButlerComment {
  id: string;
  selectedText: string;
  conversationId: string | null;
  resolved: boolean;
}

export function useButlerComments(
  editor: Editor | null,
  ydoc: Y.Doc,
  pageId: string,
) {
  // Apply comment marks from DB on mount
  useEffect(() => {
    if (!editor) return;

    async function applyButlerComments() {
      // Wait until the doc has content (collab sync)
      if (editor!.state.doc.textContent.trim().length === 0) return;

      const res = await fetch(`/api/v1/page/${pageId}/comments`);
      if (!res.ok) return;
      const { comments } = (await res.json()) as { comments: ButlerComment[] };
      if (!comments.length) return;

      let changed = false;
      const { tr } = editor!.state;

      for (const comment of comments) {
        if (!comment.conversationId) continue;

        // Check if already applied
        let alreadyTagged = false;
        editor!.state.doc.descendants((node) => {
          if (node.attrs.conversationId === comment.conversationId) {
            alreadyTagged = true;
          }
        });
        if (alreadyTagged) continue;

        // Find the paragraph node whose text content matches selectedText.
        // Only target paragraph nodes — they are the ones with conversationId
        // attribute (via ConversationParagraph). For list items, the text lives
        // inside taskItem > paragraph, so we must skip wrapper nodes like
        // taskList/taskItem/bulletList/listItem to reach the inner paragraph.
        editor!.state.doc.descendants((node, pos) => {
          if (alreadyTagged) return;
          if (node.type.name !== "paragraph") return;
          const nodeText = node.textContent.trim();
          const commentText = comment.selectedText.trim();
          if (nodeText !== commentText && !nodeText.includes(commentText)) return;

          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            conversationId: comment.conversationId,
            resolved: comment.resolved,
          });
          changed = true;
          alreadyTagged = true;
        });
      }

      if (changed) {
        editor!.view.dispatch(tr);
      }
    }

    // Retry a few times to handle collab sync delay
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      applyButlerComments();
      if (attempts >= 5) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [editor, pageId]);

  function resolveComment(conversationId: string, resolved: boolean) {
    // Update Yjs attribute so all collaborators see the change
    const fragment = ydoc.getXmlFragment("default");

    function walk(node: Y.XmlFragment | Y.XmlElement) {
      node.forEach((child) => {
        if (!(child instanceof Y.XmlElement)) return;
        if (child.getAttribute("conversationId") === conversationId) {
          child.setAttribute("resolved", resolved);
        }
        walk(child);
      });
    }

    ydoc.transact(() => walk(fragment), "client-conversation-resolved");

    // Persist in DB
    fetch(`/api/v1/page/${pageId}/comments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, resolved }),
    }).catch(() => {});
  }

  return { resolveComment };
}
