import { EditorContent, useEditor } from "@tiptap/react";

import { useEffect } from "react";

import { skillExtension } from "../editor/skill-extension";
import { extensionsForConversation } from "../conversation/editor-extensions";

export const SpaceSummary = ({ summary }: { summary?: string | null }) => {
  const editor = useEditor({
    extensions: [...extensionsForConversation, skillExtension],
    editable: false,
    content: summary,
  });

  useEffect(() => {
    if (summary) {
      editor?.commands.setContent(summary);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  if (!summary) {
    return null;
  }

  return <EditorContent editor={editor} className="editor-container" />;
};
