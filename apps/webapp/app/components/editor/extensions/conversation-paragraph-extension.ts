/**
 * Custom Paragraph extension that supports a `conversationId` attribute.
 *
 * When the server-side decision pipeline attaches a conversationId to a
 * Yjs XmlElement (paragraph), the Collaboration extension syncs it here.
 * Paragraphs with a conversationId get a subtle visual indicator (left border)
 * and are clickable to show the conversation popover.
 */

import Paragraph from "@tiptap/extension-paragraph";
import { mergeAttributes } from "@tiptap/core";

export const ConversationParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      conversationId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-conversation-id"),
        renderHTML: (attributes) => {
          if (!attributes.conversationId) return {};
          return {
            "data-conversation-id": attributes.conversationId,
          };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const hasConversation = !!node.attrs.conversationId;
    return [
      "p",
      mergeAttributes(HTMLAttributes, {
        class: hasConversation
          ? "leading-[24px] mt-[0.25rem] paragraph-node border-l-2 border-primary/30 pl-2 cursor-pointer"
          : "leading-[24px] mt-[0.25rem] paragraph-node",
      }),
      0,
    ];
  },
});
