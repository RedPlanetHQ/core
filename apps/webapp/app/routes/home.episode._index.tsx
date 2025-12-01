import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { PageHeader } from "~/components/common/page-header";
import { LabelService } from "~/services/label.server";
import { getUser } from "~/services/session.server";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle } from "lucide-react";
import { Editor } from "~/components/editor/editor.client";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const labelService = new LabelService();

  try {
    const labels = await labelService.getWorkspaceLabels(
      user?.Workspace?.id as string,
    );
    return json({ labels });
  } catch (e) {
    return json({ labels: [] });
  }
}

export default function NewEpisode() {
  return (
    <>
      <div className="flex h-full flex-col">
        <PageHeader title="New episode" />

        <div className="flex h-[calc(100vh)] w-full flex-col items-center space-y-6 pt-3 md:h-[calc(100vh_-_56px)]">
          <ClientOnly
            fallback={
              <div className="flex w-full justify-center">
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              </div>
            }
          >
            {() => {
              return <Editor />;
            }}
          </ClientOnly>
        </div>
      </div>
    </>
  );
}
