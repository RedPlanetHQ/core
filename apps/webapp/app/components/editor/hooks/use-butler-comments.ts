import * as Y from "yjs";

export function useButlerComments(
  ydoc: Y.Doc,
  pageId: string,
) {

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
