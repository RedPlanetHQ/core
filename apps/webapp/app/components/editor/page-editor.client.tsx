import React, { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Collaboration from "@tiptap/extension-collaboration";
import TaskList from "@tiptap/extension-task-list";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCollabSocket } from "~/components/editor/collab-socket-context";
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
import { ConversationParagraph } from "~/components/editor/extensions/conversation-paragraph-extension";
import { ConversationPopover } from "~/components/editor/conversation-popover";

const lowlight = createLowlight(all);

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
      paragraph: false, // Replaced by ConversationParagraph extension
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
    ConversationParagraph,
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
  const [activeConversation, setActiveConversation] = useState<{
    conversationId: string;
    rect: DOMRect;
    resolved: boolean;
  } | null>(null);

  // Load butler comments and apply conversationId to matching paragraph nodes
  useEffect(() => {
    if (!editor) return;

    async function applyButlerComments() {
      const res = await fetch(`/api/v1/page/${pageId}/comments`);
      if (!res.ok) return;
      const { comments } = await res.json() as {
        comments: { id: string; selectedText: string; conversationId: string | null; resolved: boolean }[];
      };

      if (!comments.length) return;

      const { tr } = editor!.state;
      let changed = false;

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

        // Find the paragraph node whose text content matches selectedText
        editor!.state.doc.descendants((node, pos) => {
          if (alreadyTagged) return false;
          if (!node.isBlock) return;
          if (node.textContent.trim() !== comment.selectedText.trim()) return;

          const nodeType = editor!.schema.nodes[node.type.name];
          if (!nodeType) return;

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

    // Wait for collaboration to sync before applying
    const timeout = setTimeout(applyButlerComments, 1000);
    return () => clearTimeout(timeout);
  }, [editor, pageId]);

  const updateConversationResolved = React.useCallback(
    (conversationId: string, resolved: boolean) => {
      // Update Yjs attribute for live collaborators
      const fragment = ydoc.getXmlFragment("default");
      ydoc.transact(() => {
        fragment.forEach((child) => {
          if (!(child instanceof Y.XmlElement)) return;
          if (child.getAttribute("conversationId") !== conversationId) return;
          child.setAttribute("resolved", resolved);
        });
      }, "client-conversation-resolved");

      // Persist resolved state in DB
      fetch(`/api/v1/page/${pageId}/comments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, resolved }),
      }).catch(() => {});

      setActiveConversation((current) =>
        current?.conversationId === conversationId
          ? { ...current, resolved }
          : current,
      );
    },
    [ydoc, pageId],
  );

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
      handleClick(view, pos) {
        // Check for conversation paragraph click
        const $pos = view.state.doc.resolve(pos);
        for (let depth = $pos.depth; depth > 0; depth--) {
          const node = $pos.node(depth);
          if (node.type.name === "paragraph" && node.attrs.conversationId) {
            const startPos = $pos.start(depth);
            const coords = view.coordsAtPos(startPos);
            const rect = new DOMRect(
              coords.left,
              coords.top,
              0,
              coords.bottom - coords.top,
            );
            setActiveConversation({
              conversationId: node.attrs.conversationId,
              rect,
              resolved: Boolean(node.attrs.resolved),
            });
            return true;
          }
        }
        setActiveConversation(null);
        return false;
      },
    },
  });

  return (
    <>
      <SelectionBubble editor={editor} isToday={isToday} />
      <EditorContent editor={editor} className="w-full" />
      <ConversationPopover
        conversationId={activeConversation?.conversationId ?? null}
        anchorRect={activeConversation?.rect ?? null}
        resolved={activeConversation?.resolved ?? false}
        butlerName={butlerName}
        onResolvedChange={updateConversationResolved}
        onClose={() => setActiveConversation(null)}
      />
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
  const sharedSocket = useCollabSocket();

  useEffect(() => {
    const doc = new Y.Doc();
    new IndexeddbPersistence(pageId, doc);
    const providerOptions: ConstructorParameters<typeof HocuspocusProvider>[0] =
      sharedSocket
        ? {
            websocketProvider: sharedSocket,
            name: pageId,
            document: doc,
            forceSyncInterval: 10_000,
            token: collabToken,

            onConnect: () => {
              console.log("connected");
            },
          }
        : {
            url: `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/collab`,
            name: pageId,
            document: doc,
            token: collabToken,
          };
    providerRef.current = new HocuspocusProvider(providerOptions);
    if (sharedSocket) {
      // When websocketProvider is passed, HocuspocusProvider skips calling attach()
      // internally (manageSocket stays false). We must call it manually so the
      // provider registers in the socket's providerMap and receives onOpen.
      providerRef.current.attach();
    }
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
