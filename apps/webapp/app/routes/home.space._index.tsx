import { PageHeader } from "~/components/common/page-header";
import { SpacesGrid } from "~/components/spaces/spaces-grid";
import { NewSpaceDialog } from "~/components/spaces/new-space-dialog.client";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { requireUserId } from "~/services/session.server";
import { useState } from "react";

import { SpaceService } from "~/services/space.server";
import { Plus } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const spaceService = new SpaceService();

  const spaces = await spaceService.getUserSpaces(userId);

  return json({
    spaces,
  });
}

export default function Spaces() {
  const { spaces } = useLoaderData<typeof loader>();
  const [showNewSpaceDialog, setShowNewSpaceDialog] = useState(false);

  const handleNewSpaceSuccess = () => {
    // Refresh the page to show the new space
    setShowNewSpaceDialog(false);
  };

  return (
    <>
      <PageHeader
        title="Spaces"
        actions={[
          {
            label: "New space",
            icon: <Plus size={14} />,
            onClick: () => setShowNewSpaceDialog(true),
          },
        ]}
      />
      <div className="home flex h-[calc(100vh_-_56px)] flex-col overflow-y-auto p-4 px-5">
        <SpacesGrid spaces={spaces} />
      </div>

      {setShowNewSpaceDialog && (
        <NewSpaceDialog
          open={showNewSpaceDialog}
          onOpenChange={setShowNewSpaceDialog}
          onSuccess={handleNewSpaceSuccess}
        />
      )}
    </>
  );
}
