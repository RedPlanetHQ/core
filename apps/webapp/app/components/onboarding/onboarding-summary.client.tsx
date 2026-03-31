import { useEditor, EditorContent } from "@tiptap/react";
import { extensionsForConversation } from "../conversation/editor-extensions";

export const OnboardingSummary = ({ summary }: { summary: string }) => {
  const editor = useEditor({
    extensions: [...extensionsForConversation],
    content: summary as any,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none",
      },
    },
  });

  return <EditorContent editor={editor} />;
};
