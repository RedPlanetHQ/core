import { EditorContent, EditorRoot } from "novel"
import { extensionsForConversation } from "../conversation/editor-extensions"

export const OnboardingSummary = ({ summary }: { summary: string }) => {


  return (<EditorRoot>
    <EditorContent
      editorProps={{
        attributes: {
          class: "prose prose-sm max-w-none focus:outline-none",
        },
      }}
      initialContent={summary as any}
      editable={false}
      extensions={[
        ...extensionsForConversation,

      ]}
      immediatelyRender={false}
    />
  </EditorRoot>)
}