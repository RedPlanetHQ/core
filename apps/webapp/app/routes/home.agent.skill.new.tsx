import { PageHeader } from "~/components/common/page-header";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle } from "lucide-react";
import { SkillEditor } from "~/components/editor/skill-editor.client";

export default function NewSkill() {
  return (
    <>
      <div className="episode-details flex h-full flex-col">
        <PageHeader title="New skill" />

        <ClientOnly
          fallback={
            <div className="flex w-full justify-center">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            </div>
          }
        >
          {() => {
            return <SkillEditor />;
          }}
        </ClientOnly>
      </div>
    </>
  );
}
