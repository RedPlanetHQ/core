import { PageHeader } from "~/components/common/page-header";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { requireUserId, requireWorkpace } from "~/services/session.server";

import { SpaceService } from "~/services/space.server";
import { useTypedLoaderData } from "remix-typedjson";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);

  const spaceService = new SpaceService();

  const spaceId = params.spaceId; // Get spaceId from URL params
  const space = await spaceService.getSpace(spaceId as string, userId);

  return space;
}

export default function Space() {
  const space = useTypedLoaderData<typeof loader>();

  return (
    <>
      <PageHeader
        title="Space"
        breadcrumbs={[
          { label: "Spaces", href: "/home/space" },
          { label: space?.name || "Untitled" },
        ]}
        tabs={[
          {
            label: "Overview",
            value: "overview",
            isActive: true,
            onClick: () => {},
          },
          {
            label: "Facts",
            value: "facts",
            isActive: false,
            onClick: () => {},
          },
        ]}
      />
      <div className="relative flex h-[calc(100vh_-_56px)] w-full flex-col items-center justify-center overflow-auto"></div>
    </>
  );
}
