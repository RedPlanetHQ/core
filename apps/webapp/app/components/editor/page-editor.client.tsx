import React, { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Collaboration from "@tiptap/extension-collaboration";
import TaskList from "@tiptap/extension-task-list";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { all, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";
import { mergeAttributes } from "@tiptap/core";
import { cx } from "class-variance-authority";

import { CustomTaskItem } from "~/components/editor/extensions/custom-task-item";
import { buildMentionExtension } from "~/components/editor/extensions/mention-extension";
import { SlashCommand } from "~/components/editor/extensions/slash-command";
import { ButlerTaskExtension } from "~/components/editor/extensions/butler-task-extension";
import { TaskPickerExtension } from "~/components/editor/extensions/task-picker-extension";
import { ChecklistInputRule } from "~/components/editor/extensions/checklist-input-rule";
import { SelectionBubble } from "~/components/editor/selection-bubble";

const lowlight = createLowlight(all);

function getCollabURL(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/collab`;
}

function buildExtensions(
  pageId: string,
  isToday: boolean,
  butlerName: string,
  ydoc: Y.Doc,
  parentTaskId?: string,
) {
  const heading = Heading.extend({
    renderHTML({ node, HTMLAttributes }) {
      const level: 1 | 2 | 3 = node.attrs.level;
      const levelMap: Record<number, string> = {
        1: "text-2xl",
        2: "text-xl",
        3: "text-lg",
      };
      return [
        `h${level}`,
        mergeAttributes(HTMLAttributes, {
          class: `h${level}-style ${levelMap[level] ?? "text-base"} mt-4 font-medium`,
        }),
        0,
      ];
    },
  }).configure({ levels: [1, 2, 3] });

  return [
    StarterKit.configure({
      heading: false,
      history: false,
      bulletList: {
        HTMLAttributes: {
          class: cx("list-disc list-outside pl-4 leading-1 my-1"),
        },
      },
      orderedList: {
        HTMLAttributes: {
          class: cx("list-decimal list-outside pl-4 leading-1 my-1"),
        },
      },
      listItem: { HTMLAttributes: { class: cx("mt-1.5") } },
      blockquote: {
        HTMLAttributes: { class: cx("border-l-4 border-border pl-2") },
      },
      paragraph: {
        HTMLAttributes: {
          class: cx("leading-[24px] mt-[0.25rem] paragraph-node"),
        },
      },
      codeBlock: false,
      code: {
        HTMLAttributes: {
          class: cx(
            "rounded bg-muted text-[#BF4594] px-1.5 py-1 font-mono font-medium",
          ),
          spellcheck: "false",
        },
      },
      horizontalRule: false,
      dropcursor: { color: "#DBEAFE", width: 4 },
      gapcursor: false,
      link: {
        HTMLAttributes: { class: "text-primary cursor-pointer" },
        openOnClick: false,
      },
    }),
    heading,
    TaskList.configure({
      HTMLAttributes: { class: cx("list-none pl-0 my-1") },
    }),
    CustomTaskItem,
    CodeBlockLowlight.configure({ lowlight }),
    Markdown,
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
        return "Write notes...";
      },
      includeChildren: true,
    }),
    ChecklistInputRule,
    ButlerTaskExtension({ pageId, isToday, parentTaskId }),
    buildMentionExtension(butlerName),
    SlashCommand,
    TaskPickerExtension,
    Collaboration.configure({ document: ydoc }),
  ];
}

function EditorInner({
  pageId,
  isToday,
  butlerName,
  minHeight,
  parentTaskId,
  ydoc,
}: {
  pageId: string;
  isToday: boolean;
  butlerName: string;
  collabToken: string;
  minHeight: string;
  parentTaskId?: string;
  ydoc: Y.Doc;
}) {
  const editor = useEditor({
    extensions: buildExtensions(
      pageId,
      isToday,
      butlerName,
      ydoc,
      parentTaskId,
    ),
    editorProps: {
      attributes: {
        class: "prose prose-sm focus:outline-none max-w-full py-1",
        style: `min-height: ${minHeight}`,
      },
    },
  });

  return (
    <>
      <SelectionBubble editor={editor} isToday={isToday} />
      <EditorContent editor={editor} className="w-full" />
    </>
  );
}

export interface PageEditorProps {
  pageId: string;
  collabToken: string;
  butlerName: string;
  isToday?: boolean;
  parentTaskId?: string;
  minHeight?: string;
}

export function PageEditor({
  pageId,
  collabToken,
  butlerName,
  isToday = false,
  parentTaskId,
  minHeight = "400px",
}: PageEditorProps) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    new IndexeddbPersistence(pageId, doc);
    providerRef.current = new HocuspocusProvider({
      url: getCollabURL(),
      name: pageId,
      document: doc,
      token: collabToken,
    });
    const t = setTimeout(() => setYdoc(doc), 50);

    return () => {
      clearTimeout(t);
      providerRef.current?.destroy();
      doc.destroy();
      setYdoc(null);
    };
  }, [pageId]);

  if (!ydoc) return <div style={{ minHeight }} />;

  return (
    <EditorInner
      pageId={pageId}
      isToday={isToday}
      butlerName={butlerName}
      collabToken={collabToken}
      minHeight={minHeight}
      parentTaskId={parentTaskId}
      ydoc={ydoc}
    />
  );
}

// Convenience re-export so daily page imports still work
export function DayEditor({
  pageId,
  collabToken,
  butlerName,
  isToday,
}: {
  pageId: string;
  collabToken: string;
  butlerName: string;
  isToday: boolean;
}) {
  return (
    <PageEditor
      pageId={pageId}
      collabToken={collabToken}
      butlerName={butlerName}
      isToday={isToday}
    />
  );
}
