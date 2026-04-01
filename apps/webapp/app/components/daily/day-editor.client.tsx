import React, { useEffect, useRef, useCallback, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Collaboration from "@tiptap/extension-collaboration";
import TaskList from "@tiptap/extension-task-list";
import { CustomTaskItem } from "~/components/editor/extensions/custom-task-item";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { all, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";
import { mergeAttributes } from "@tiptap/core";
import { cx } from "class-variance-authority";

import { ButlerExtension } from "~/components/editor/extensions/butler-extension";
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
      const levelMap: Record<number, string> = { 1: "text-2xl", 2: "text-xl", 3: "text-lg" };
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
      bulletList: { HTMLAttributes: { class: cx("list-disc list-outside pl-4 leading-1 my-1") } },
      orderedList: { HTMLAttributes: { class: cx("list-decimal list-outside pl-4 leading-1 my-1") } },
      listItem: { HTMLAttributes: { class: cx("mt-1.5") } },
      blockquote: { HTMLAttributes: { class: cx("border-l-4 border-border pl-2") } },
      paragraph: { HTMLAttributes: { class: cx("leading-[24px] mt-4 paragraph-node") } },
      codeBlock: false,
      code: {
        HTMLAttributes: {
          class: cx("rounded bg-muted text-[#BF4594] px-1.5 py-1 font-mono font-medium"),
          spellcheck: "false",
        },
      },
      horizontalRule: false,
      dropcursor: { color: "#DBEAFE", width: 4 },
      gapcursor: false,
      link: { HTMLAttributes: { class: "text-primary cursor-pointer" }, openOnClick: false },
    }),
    heading,
    TaskList.configure({ HTMLAttributes: { class: cx("list-none pl-0 my-1") } }),
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
    // [] → taskList input rule (standalone so chain() has full editor context)
    ChecklistInputRule,
    // Inline task chip created via selection or [[ picker
    ButlerTaskExtension({ pageId, isToday }),
    ButlerExtension,
    buildMentionExtension(butlerName),
    SlashCommand,
    // [[ → task search picker
    TaskPickerExtension,
    // Collaboration must come last
    Collaboration.configure({ document: ydoc }),
  ];
}

const IDLE_THRESHOLD_MS = 60_000;

function EditorWithDoc({
  pageId,
  isToday,
  butlerName,
  ydoc,
}: {
  pageId: string;
  isToday: boolean;
  butlerName: string;
  collabToken: string;
  ydoc: Y.Doc;
}) {
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedMentionsRef = useRef<Set<string>>(new Set());

  const scanAndExecuteMentions = useCallback(
    (editor: any) => {
      if (!editor) return;
      editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name !== "mention") return;

        const key = `${pos}-${node.attrs.id}`;
        if (processedMentionsRef.current.has(key)) return;

        const $pos = editor.state.doc.resolve(pos);
        const parent = $pos.parent;
        const grandParent = $pos.node($pos.depth - 1);
        const nextNode = grandParent.maybeChild($pos.indexAfter($pos.depth - 1));
        if (nextNode?.type.name === "butlerBlock") return;

        const instruction = parent.textContent?.replace(/@\S+/g, "").trim();
        if (!instruction) return;
        processedMentionsRef.current.add(key);

        fetch("/api/v1/conversation/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: instruction, source: "daily" }),
        })
          .then((r) => r.json())
          .then((conv) => {
            const endOfParent = pos + parent.nodeSize - 1;
            editor
              .chain()
              .focus()
              .insertContentAt(endOfParent, {
                type: "butlerBlock",
                attrs: {
                  conversationId: conv.id ?? conv.conversationId ?? null,
                  butlerName,
                  content: null,
                },
              })
              .run();
            if (conv.id || conv.conversationId) {
              pollConversation(conv.id ?? conv.conversationId, editor, butlerName);
            }
          })
          .catch(console.error);
      });
    },
    [butlerName],
  );

  const editor = useEditor({
    extensions: buildExtensions(pageId, isToday, butlerName, ydoc),
    editorProps: {
      attributes: {
        class: "prose prose-sm focus:outline-none max-w-full min-h-[400px] py-1",
      },
    },
    onUpdate({ editor }) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        scanAndExecuteMentions(editor);
      }, IDLE_THRESHOLD_MS);
    },
  });

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  return (
    <>
      <SelectionBubble editor={editor} />
      <EditorContent editor={editor} className="w-full" />
    </>
  );
}

export function DayEditor({
  pageId,
  isToday,
  butlerName,
  collabToken,
}: {
  pageId: string;
  isToday: boolean;
  butlerName: string;
  collabToken: string;
}) {
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

  if (!ydoc) return <div className="min-h-[60px]" />;

  return (
    <EditorWithDoc
      pageId={pageId}
      isToday={isToday}
      butlerName={butlerName}
      collabToken={collabToken}
      ydoc={ydoc}
    />
  );
}

function pollConversation(conversationId: string, editor: any, butlerName: string) {
  let attempts = 0;
  const poll = setInterval(async () => {
    if (++attempts > 60) { clearInterval(poll); return; }
    try {
      const data = await fetch(`/api/v1/conversation/${conversationId}`).then((r) => r.json());
      const last = data.messages?.findLast?.((m: any) => m.role === "assistant");
      if (last?.content) {
        editor.state.doc.descendants((node: any, pos: number) => {
          if (node.type.name === "butlerBlock" && node.attrs.conversationId === conversationId) {
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, content: last.content }),
            );
            clearInterval(poll);
          }
        });
      }
    } catch { /* ignore */ }
  }, 3000);
}
