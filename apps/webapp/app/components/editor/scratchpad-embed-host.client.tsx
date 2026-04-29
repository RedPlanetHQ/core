import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";

import { PageEditor } from "~/components/editor/page-editor.client";

// Listens for `window.postMessage` commands from the React Native
// WebView host and dispatches them to the Tiptap editor. Each message
// is `{ type: "core-editor", command: "<name>", payload?: any }` so we
// can extend the protocol without colliding with other listeners.
const COMMAND_TYPE = "core-editor";

type Command =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "h1"
  | "h2"
  | "h3"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "code-block"
  | "undo"
  | "redo"
  | "clear-marks"
  | "slash"
  | "focus";

function applyCommand(editor: Editor, command: Command) {
  const chain = editor.chain().focus();
  switch (command) {
    case "bold":
      chain.toggleBold().run();
      return;
    case "italic":
      chain.toggleItalic().run();
      return;
    case "strike":
      chain.toggleStrike().run();
      return;
    case "code":
      chain.toggleCode().run();
      return;
    case "h1":
      chain.toggleHeading({ level: 1 }).run();
      return;
    case "h2":
      chain.toggleHeading({ level: 2 }).run();
      return;
    case "h3":
      chain.toggleHeading({ level: 3 }).run();
      return;
    case "bullet-list":
      chain.toggleBulletList().run();
      return;
    case "ordered-list":
      chain.toggleOrderedList().run();
      return;
    case "task-list":
      chain.toggleTaskList().run();
      return;
    case "blockquote":
      chain.toggleBlockquote().run();
      return;
    case "code-block":
      chain.toggleCodeBlock().run();
      return;
    case "undo":
      chain.undo().run();
      return;
    case "redo":
      chain.redo().run();
      return;
    case "clear-marks":
      chain.unsetAllMarks().run();
      return;
    case "slash":
      // Insert a literal "/" — slash-command suggestion picks it up.
      chain.insertContent("/").run();
      return;
    case "focus":
      chain.run();
      return;
  }
}

export function ScratchpadEmbedHost(props: {
  pageId: string;
  collabToken: string;
  butlerName: string;
}) {
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if ((data as { type?: string }).type !== COMMAND_TYPE) return;
      const command = (data as { command?: Command }).command;
      const editor = editorRef.current;
      if (!editor || !command) return;
      applyCommand(editor, command);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);


  return (
    <PageEditor
      pageId={props.pageId}
      collabToken={props.collabToken}
      butlerName={props.butlerName}
      isToday
      minHeight="100vh"
      disableSelectionBubble
      onEditor={(editor) => {
        editorRef.current = editor ?? null;
        if (!editor) return;

        // Push messages back to the RN host. Single helper so we can
        // bail safely when running outside a WebView context (eg. when
        // a developer opens /embed in a browser).
        const post = (payload: unknown) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = window as any;
          if (w.ReactNativeWebView?.postMessage) {
            w.ReactNativeWebView.postMessage(JSON.stringify(payload));
          }
        };

        // Focus state — drives toolbar visibility on RN.
        editor.on("focus", () => post({ type: "core-editor-focus", focused: true }));
        editor.on("blur", () => post({ type: "core-editor-focus", focused: false }));

        // Cursor position — drives auto-scroll so the cursor stays
        // visible above the keyboard (Apple Notes style). We send the
        // bottom edge of the selection so the host can leave a small
        // gap between the cursor and the keyboard.
        const postCursor = () => {
          try {
            const { from } = editor.state.selection;
            const coords = editor.view.coordsAtPos(from);
            // coordsAtPos returns viewport-relative pixels; add the page's
            // own scroll offset so the host gets a document-relative Y.
            const top = coords.top + window.scrollY;
            const bottom = coords.bottom + window.scrollY;
            post({ type: "core-editor-cursor", top, bottom });
          } catch {
            // Selection may not have a valid position during teardown.
          }
        };
        editor.on("selectionUpdate", postCursor);
        editor.on("transaction", postCursor);
      }}
    />
  );
}
