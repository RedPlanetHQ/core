import { cx } from "class-variance-authority";
import {
  StarterKit,
  TiptapLink,
  HorizontalRule,
  Placeholder,
  HighlightExtension,
  AIHighlight,
} from "novel";

import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Heading from "@tiptap/extension-heading";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { all, createLowlight } from "lowlight";
import { mergeAttributes, type Extension } from "@tiptap/react";

// create a lowlight instance with all languages loaded
export const lowlight = createLowlight(all);

const tiptapLink = TiptapLink.configure({
  HTMLAttributes: {
    class: cx("text-primary cursor-pointer"),
  },
});

const horizontalRule = HorizontalRule.configure({
  HTMLAttributes: {
    class: cx("my-2 border-t border-muted-foreground"),
  },
});

const heading = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const hasLevel = this.options.levels.includes(node.attrs.level);
    const level: 1 | 2 | 3 = hasLevel
      ? node.attrs.level
      : this.options.levels[0];
    const levelMap = { 1: "text-2xl", 2: "text-xl", 3: "text-lg" };

    return [
      `h${level}`,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: `heading-node h${node.attrs.level}-style ${levelMap[level]} my-[1rem] font-medium`,
      }),
      0,
    ];
  },
}).configure({ levels: [1, 2, 3] });

const defaultPlaceholder = Placeholder.configure({
  placeholder: ({ node }) => {
    if (node.type.name === "heading") {
      return `Heading ${node.attrs.level}`;
    }
    if (node.type.name === "image" || node.type.name === "table") {
      return "";
    }
    if (node.type.name === "codeBlock") {
      return "Type in your code here...";
    }

    return "";
  },
  includeChildren: true,
});

export const getPlaceholder = (placeholder: string | Extension) => {
  if (!placeholder) {
    return defaultPlaceholder;
  }

  if (typeof placeholder === "string") {
    return Placeholder.configure({
      placeholder: () => {
        return placeholder;
      },
      includeChildren: true,
    });
  }

  return placeholder;
};

export const starterKit = StarterKit.configure({
  heading: false,
  history: false,
  bulletList: {
    HTMLAttributes: {
      class: cx("list-disc list-outside pl-4 leading-1 my-1 mb-1.5"),
    },
  },
  orderedList: {
    HTMLAttributes: {
      class: cx("list-decimal list-outside pl-4 leading-1 my-1"),
    },
  },
  listItem: {
    HTMLAttributes: {
      class: cx("mt-1.5"),
    },
  },
  blockquote: {
    HTMLAttributes: {
      class: cx("border-l-4 border-gray-400 dark:border-gray-500"),
    },
  },
  paragraph: {
    HTMLAttributes: {
      class: cx("leading-[24px] mt-[1rem] paragraph-node"),
    },
  },
  codeBlock: false,
  code: {
    HTMLAttributes: {
      class: cx(
        "rounded bg-grayAlpha-100 text-[#BF4594] px-1.5 py-1 font-mono font-medium border-none",
      ),
      spellcheck: "false",
    },
  },
  horizontalRule: false,
  dropcursor: {
    color: "#DBEAFE",
    width: 4,
  },
  gapcursor: false,
});

export const extensionsForConversation = [
  starterKit,
  tiptapLink,
  horizontalRule,
  heading,
  AIHighlight,
  HighlightExtension,
  Table.configure({
    resizable: true,
  }),
  TableRow,
  TableHeader,
  TableCell,
  CodeBlockLowlight.configure({
    lowlight,
  }),
];
