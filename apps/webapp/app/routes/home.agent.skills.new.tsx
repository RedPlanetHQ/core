import { useCallback, useRef, useState } from "react";
import { PageHeader } from "~/components/common/page-header";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle } from "lucide-react";
import {
  SkillEditor,
  type SkillEditorHandle,
  type SkillEditorMeta,
} from "~/components/editor/skill-editor.client";
import { Button } from "~/components/ui";

export default function NewSkill() {
  const editorRef = useRef<SkillEditorHandle>(null);
  const [meta, setMeta] = useState<SkillEditorMeta>({
    isDirty: false,
    isSaving: false,
    isDeleting: false,
  });

  const handleMetaChange = useCallback((next: SkillEditorMeta) => {
    setMeta(next);
  }, []);

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        onClick={() => editorRef.current?.save()}
        disabled={!meta.isDirty || meta.isSaving}
      >
        {meta.isSaving ? "Creating..." : "Create skill"}
      </Button>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="New skill" actionsNode={headerActions} />

      <ClientOnly
        fallback={
          <div className="flex w-full justify-center">
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          </div>
        }
      >
        {() => <SkillEditor ref={editorRef} onMetaChange={handleMetaChange} />}
      </ClientOnly>
    </div>
  );
}
