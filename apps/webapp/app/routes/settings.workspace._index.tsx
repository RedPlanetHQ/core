import { useState } from "react";
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { SettingSection } from "~/components/setting-section";
import { Button, Input } from "~/components/ui";
import { requireUser } from "~/services/session.server";
import { getWorkspaceById } from "~/models/workspace.server";
import { prisma } from "~/db.server";
import { sessionStorage } from "~/services/sessionStorage.server";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Card, CardContent } from "~/components/ui/card";
import { AvatarText } from "~/components/ui/avatar";
import { Trash2 } from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const { workspaceId } = await requireUser(request);

  if (!workspaceId) {
    throw new Error("Workspace not found");
  }

  const workspace = await getWorkspaceById(workspaceId);

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  // Get member count
  const memberCount = await prisma.userWorkspace.count({
    where: {
      workspaceId,
      isActive: true,
    },
  });

  return json({ workspace, memberCount });
}

export async function action({ request }: ActionFunctionArgs) {
  const { workspaceId, id: userId } = await requireUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (!workspaceId) {
    throw json({ error: "Workspace not found" }, { status: 404 });
  }

  if (intent === "delete") {
    const confirmName = formData.get("confirmName") as string;
    const workspace = await getWorkspaceById(workspaceId);

    if (!workspace) {
      return json({ error: "Workspace not found" }, { status: 404 });
    }

    if (confirmName !== workspace.name) {
      return json({ error: "Workspace name does not match" }, { status: 400 });
    }

    // Check if user has other workspaces
    const otherWorkspaces = await prisma.userWorkspace.findMany({
      where: {
        userId,
        isActive: true,
        workspaceId: { not: workspaceId },
      },
      include: {
        workspace: true,
      },
    });

    if (otherWorkspaces.length === 0) {
      return json(
        { error: "You cannot delete your only workspace" },
        { status: 400 },
      );
    }

    // Soft delete: deactivate the user's membership
    await prisma.userWorkspace.updateMany({
      where: {
        workspaceId,
        userId,
      },
      data: {
        isActive: false,
      },
    });

    // Switch to the next available workspace
    const nextWorkspace = otherWorkspaces[0];

    // Update session with new workspaceId
    const session = await sessionStorage.getSession(
      request.headers.get("Cookie"),
    );
    session.set("user", {
      userId,
      workspaceId: nextWorkspace.workspaceId,
    });

    return redirect("/", {
      headers: {
        "Set-Cookie": await sessionStorage.commitSession(session),
      },
    });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
}

export default function WorkspaceSettings() {
  const { workspace, memberCount } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [confirmName, setConfirmName] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const isDeleting = fetcher.state === "submitting";
  const canDelete = confirmName === workspace.name;

  const handleDelete = () => {
    fetcher.submit({ intent: "delete", confirmName }, { method: "POST" });
  };

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Workspace Overview"
        description="Manage your workspace settings and configuration."
      >
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-md mb-4">Workspace details</h2>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-4">
                  <AvatarText
                    text={workspace.name}
                    className="h-12 w-12 rounded text-lg"
                  />
                  <div>
                    <h3 className="text-lg font-medium">{workspace.name}</h3>
                    <p className="text-muted-foreground text-sm">
                      {memberCount} {memberCount === 1 ? "member" : "members"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <h2 className="text-md mb-4"> Danger Zone</h2>
            <Card className="border-destructive/50">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Delete this workspace</p>
                    <p className="text-muted-foreground text-sm">
                      Once deleted, you will lose access to this workspace.
                    </p>
                  </div>
                  <AlertDialog
                    open={isDeleteDialogOpen}
                    onOpenChange={setIsDeleteDialogOpen}
                  >
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="lg">
                        <Trash2 size={16} className="mr-2" />
                        Delete Workspace
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Workspace</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. This will permanently
                          remove your access to the workspace{" "}
                          <strong>{workspace.name}</strong>.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="my-4">
                        <label className="text-sm font-medium">
                          Type <strong>{workspace.name}</strong> to confirm
                        </label>
                        <Input
                          className="mt-2"
                          placeholder={workspace.name}
                          value={confirmName}
                          onChange={(e) => setConfirmName(e.target.value)}
                        />
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setConfirmName("")}>
                          Cancel
                        </AlertDialogCancel>
                        <Button
                          variant="destructive"
                          onClick={handleDelete}
                          disabled={!canDelete || isDeleting}
                        >
                          {isDeleting ? "Deleting..." : "Delete Workspace"}
                        </Button>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </SettingSection>
    </div>
  );
}
