import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { PageHeader } from "~/components/common/page-header";
import { LabelService } from "~/services/label.server";
import { getUser, getWorkspaceId } from "~/services/session.server";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle } from "lucide-react";
import { Editor } from "~/components/editor/editor.client";
import { useLoaderData, useParams } from "@remix-run/react";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const labelService = new LabelService();
  const workspaceId = await getWorkspaceId(request, user?.id as string);

  try {
    const labels = await labelService.getWorkspaceLabels(
      workspaceId as string,
    );
    return json({ labels });
  } catch (e) {
    return json({ labels: [] });
  }
}

export default function NewEpisode() {
  const { labels } = useLoaderData<typeof loader>();
  const { labelId } = useParams();

  return (
    <>
      <div className="episode-details flex h-full flex-col">
        <PageHeader title="New document" />

        <ClientOnly
          fallback={
            <div className="flex w-full justify-center">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            </div>
          }
        >
          {() => {
            return <Editor defaultLabelId={labelId} labels={labels as any} />;
          }}
        </ClientOnly>
      </div>
    </>
  );
}
