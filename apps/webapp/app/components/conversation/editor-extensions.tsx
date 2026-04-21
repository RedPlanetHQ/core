import { cx } from "class-variance-authority";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Placeholder from "@tiptap/extension-placeholder";

import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Heading from "@tiptap/extension-heading";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { all, createLowlight } from "lowlight";
import { mergeAttributes } from "@tiptap/core";
import { type Extension } from "@tiptap/react";
import { Markdown } from "tiptap-markdown";

// create a lowlight instance with all languages loaded
export const lowlight = createLowlight(all);

const tiptapLink = Link.configure({
  HTMLAttributes: {
    class: cx("text-primary cursor-pointer"),
  },
  openOnClick: false,
  autolink: true,
});

const horizontalRule = HorizontalRule.configure({
  HTMLAttributes: {
    class: cx("my-2 border-t border-gray-300"),
  },
});

const heading = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const hasLevel = this.options.levels.includes(node.attrs.level);
    const level: 1 | 2 | 3 | 4 = hasLevel
      ? node.attrs.level
      : this.options.levels[0];
    const levelMap = {
      1: "text-2xl",
      2: "text-xl",
      3: "text-lg",
      4: "text-md",
    };

    return [
      `h${level}`,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: `heading-node h${node.attrs.level}-style ${levelMap[level]} my-[0.25rem] font-medium`,
      }),
      0,
    ];
  },
}).configure({ levels: [1, 2, 3, 4] });

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

  bulletList: {
    HTMLAttributes: {
      class: cx("list-disc list-outside pl-6 leading-1 my-1 mb-1.5"),
    },
  },
  orderedList: {
    HTMLAttributes: {
      class: cx("list-decimal list-outside pl-6 leading-1 my-1"),
    },
  },
  listItem: {
    HTMLAttributes: {
      class: cx("mt-1"),
    },
  },
  blockquote: {
    HTMLAttributes: {
      class: cx("border-l-2 border-border pl-2"),
    },
  },
  paragraph: {
    HTMLAttributes: {
      class: cx("leading-[22px] mt-[0.25rem] paragraph-node !text-[14px]"),
    },
  },
  codeBlock: false,
  code: {
    HTMLAttributes: {
      class: cx(
        "rounded bg-grayAlpha-50 border border-border text-muted-foreground px-1.5 py-0 font-mono",
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
  Table.configure({
    resizable: true,
  }),
  TableRow,
  TableHeader,
  TableCell,
  CodeBlockLowlight.configure({
    lowlight,
  }),
  Markdown,
];
