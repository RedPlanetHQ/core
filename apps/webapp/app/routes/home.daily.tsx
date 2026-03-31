import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { useLoaderData } from "@remix-run/react";
import { typedjson } from "remix-typedjson";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { ClientOnly } from "remix-utils/client-only";
import { DailyPage } from "~/components/daily/daily-page.client";
import { PageHeader } from "~/components/common/page-header";
import { generateCollabToken } from "~/services/collab-token.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  return typedjson({
    butlerName: workspace?.name ?? "butler",
    workspaceId: workspace?.id ?? "",
    userId: user.id,
    collabToken: generateCollabToken(workspace?.id ?? "", user.id),
  });
};

export default function DailyRoute() {
  const { butlerName, workspaceId, userId, collabToken } = useLoaderData<
    typeof loader
  >() as any;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Scratchpad" />
      <div className="flex h-[calc(100vh)] flex-col items-center overflow-y-auto p-2 px-3 md:h-[calc(100vh_-_56px)]">
        <ClientOnly
          fallback={
            <div className="text-muted-foreground p-6 text-sm">Loading…</div>
          }
        >
          {() => (
            <DailyPage
              butlerName={butlerName}
              workspaceId={workspaceId}
              userId={userId}
              collabToken={collabToken}
            />
          )}
        </ClientOnly>
      </div>
    </div>
  );
}
