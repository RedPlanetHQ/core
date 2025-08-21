import { PageHeader } from "~/components/common/page-header";
import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
  redirect,
} from "@remix-run/server-runtime";
import { requireUserId } from "~/services/session.server";

import { SpaceService } from "~/services/space.server";
import { useTypedLoaderData } from "remix-typedjson";
import { Outlet, useLocation, useNavigate } from "@remix-run/react";
import { SpaceOptions } from "~/components/spaces/space-options";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);

  const spaceService = new SpaceService();

  const spaceId = params.spaceId; // Get spaceId from URL params
  const space = await spaceService.getSpace(spaceId as string, userId);

  return space;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const spaceService = new SpaceService();
  const spaceId = params.spaceId;

  if (!spaceId) {
    throw new Error("Space ID is required");
  }

  const formData = await request.formData();
  const icon = formData.get("icon");

  if (typeof icon !== "string") {
    throw new Error("Invalid icon data");
  }

  await spaceService.updateSpace(spaceId, { icon }, userId);

  return redirect(`/home/space/${spaceId}`);
}

export default function Space() {
  const space = useTypedLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Space"
        breadcrumbs={[
          { label: "Spaces", href: "/home/space" },
          {
            label: (
              <div className="flex items-center gap-2">
                <span>{space?.name || "Untitled"}</span>
              </div>
            ),
          },
        ]}
        tabs={[
          {
            label: "Overview",
            value: "overview",
            isActive: location.pathname.includes("/overview"),
            onClick: () => navigate(`/home/space/${space.id}/overview`),
          },
          {
            label: "Facts",
            value: "facts",
            isActive: location.pathname.includes("/facts"),
            onClick: () => navigate(`/home/space/${space.id}/facts`),
          },
        ]}
        actionsNode={
          <SpaceOptions 
            id={space.id as string} 
            name={space.name}
            description={space.description}
          />
        }
      />
      <div className="relative flex h-[calc(100vh_-_56px)] w-full flex-col items-center justify-start overflow-auto">
        <Outlet />
      </div>
    </>
  );
}
