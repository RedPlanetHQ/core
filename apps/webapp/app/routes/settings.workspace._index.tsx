import { useState, useCallback } from "react";
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
import { Trash2, RefreshCw } from "lucide-react";
import Avatar from "boring-avatars";
import { generateOklchColor } from "~/components/ui/color-utils";
import { toHex } from "~/lib/color-utils";
import { cn } from "~/lib/utils";

const DEFAULT_ACCENT = "#c87844";

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

  const meta = (workspace.metadata ?? {}) as Record<string, unknown>;
  const accentColor = (meta.accentColor as string) || DEFAULT_ACCENT;

  return json({ workspace, memberCount, accentColor });
}

export async function action({ request }: ActionFunctionArgs) {
  const { workspaceId, id: userId } = await requireUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (!workspaceId) {
    throw json({ error: "Workspace not found" }, { status: 404 });
  }

  if (intent === "update") {
    const name = (formData.get("name") as string)?.trim();
    const slug = (formData.get("slug") as string)?.trim();

    if (!name || !slug) {
      return json({ error: "Name and slug are required" }, { status: 400 });
    }

    // Check slug uniqueness (exclude current workspace)
    const conflict = await prisma.workspace.findFirst({
      where: { slug, id: { not: workspaceId } },
    });

    if (conflict) {
      return json({ error: "Slug is already taken" }, { status: 400 });
    }

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { name, slug },
    });

    return json({ success: true });
  }

  if (intent === "updateAccentColor") {
    const accentColor = (formData.get("accentColor") as string)?.trim();
    if (!accentColor) {
      return json({ error: "Missing color" }, { status: 400 });
    }
    const existing = await prisma.workspace.findFirst({
      where: { id: workspaceId },
      select: { metadata: true },
    });
    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { metadata: { ...existingMeta, accentColor } },
    });
    return json({ success: true });
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
  const {
    workspace,
    memberCount,
    accentColor: savedAccentColor,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const updateFetcher = useFetcher<{ error?: string; success?: boolean }>();
  const colorFetcher = useFetcher<{ error?: string; success?: boolean }>();
  const [confirmName, setConfirmName] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [accentColor, setAccentColor] = useState(savedAccentColor);

  const isDeleting = fetcher.state === "submitting";
  const canDelete = confirmName === workspace.name;
  const isSaving = updateFetcher.state === "submitting";
  const hasChanges = name !== workspace.name || slug !== workspace.slug;
  const isSavingColor = colorFetcher.state === "submitting";
  const colorChanged = accentColor !== savedAccentColor;

  const generateSwatches = useCallback(() => {
    return Array.from({ length: 10 }, () => toHex(generateOklchColor()));
  }, []);

  const [swatches, setSwatches] = useState<string[]>(() => generateSwatches());

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
            <h2 className="text-md mb-4">Butler settings</h2>
            <Card>
              <CardContent className="flex flex-col gap-4 p-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Butler name"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Slug</label>
                  <Input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="workspace-slug"
                  />
                  <p className="text-muted-foreground text-xs">
                    Used as the butler's email prefix. Must be unique.
                  </p>
                </div>
                {updateFetcher.data?.error && (
                  <p className="text-destructive text-sm">
                    {updateFetcher.data.error}
                  </p>
                )}
                {updateFetcher.data?.success && (
                  <p className="text-sm text-green-600">Saved successfully.</p>
                )}
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() =>
                      updateFetcher.submit(
                        { intent: "update", name, slug },
                        { method: "POST" },
                      )
                    }
                    disabled={!hasChanges || isSaving}
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <h2 className="text-md mb-4">Butler color</h2>
            <Card>
              <CardContent className="flex flex-col gap-4 p-4">
                <div className="flex items-center gap-4">
                  <Avatar
                    name={name || "butler"}
                    variant="pixel"
                    colors={["var(--background-3)", accentColor]}
                    size={56}
                  />
                  <div className="flex flex-1 flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      {swatches.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setAccentColor(color)}
                          className={cn(
                            "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none",
                            accentColor === color
                              ? "border-border"
                              : "border-transparent",
                          )}
                          style={{
                            backgroundColor: color,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={() => setSwatches(generateSwatches())}
                    type="button"
                  >
                    <RefreshCw size={13} className="mr-1.5" />
                    Regenerate
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    disabled={!colorChanged || isSavingColor}
                    onClick={() =>
                      colorFetcher.submit(
                        { intent: "updateAccentColor", accentColor },
                        { method: "POST" },
                      )
                    }
                  >
                    {isSavingColor ? "Saving..." : "Save color"}
                  </Button>
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
