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
        keepOnSplit: false,
        parseHTML: (element) => element.getAttribute("data-conversation-id"),
        renderHTML: (attributes) => {
          if (!attributes.conversationId) return {};
          return {
            "data-conversation-id": attributes.conversationId,
          };
        },
      },
      resolved: {
        default: false,
        keepOnSplit: false,
        parseHTML: (element) =>
          element.getAttribute("data-resolved") === "true",
        renderHTML: (attributes) => {
          if (!attributes.conversationId) return {};
          return {
            "data-resolved": String(Boolean(attributes.resolved)),
          };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const hasConversation = !!node.attrs.conversationId;
    const isResolved = !!node.attrs.resolved;
    const hasText = node.textContent.trim().length > 0;

    if (!hasConversation || !hasText) {
      return [
        "p",
        mergeAttributes(HTMLAttributes, {
          class: "leading-[24px] mt-[0.25rem] paragraph-node",
        }),
        0,
      ];
    }

    return [
      "p",
      mergeAttributes(HTMLAttributes, {
        class: "leading-[24px] mt-[0.25rem] paragraph-node",
      }),
      [
        "span",
        {
          class: [
            "inline cursor-pointer px-1 py-0.5 transition-colors box-decoration-clone",
            isResolved
              ? "bg-primary/15 text-foreground/50"
              : "bg-primary/30 text-foreground",
          ].join(" "),
        },
        0,
      ],
    ];
  },
});
