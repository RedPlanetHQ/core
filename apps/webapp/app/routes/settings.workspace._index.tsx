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
import {
  SamAvatar,
  SAM_EYE_OPTIONS,
  SAM_EYE_COLOR_OPTIONS,
} from "~/components/ui/sam-avatar";
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
  const agentEye = (meta.agentEye as string) || "bot-pixel-classic";
  const agentEyeColor = (meta.agentEyeColor as string) || "#74E07A";

  return json({ workspace, memberCount, accentColor, agentEye, agentEyeColor });
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
    const agentEye = (formData.get("agentEye") as string)?.trim();
    const agentEyeColor = (formData.get("agentEyeColor") as string)?.trim();

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

    const existing = await prisma.workspace.findFirst({
      where: { id: workspaceId },
      select: { metadata: true },
    });
    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const nextMeta: Record<string, unknown> = { ...existingMeta };
    if (agentEye) nextMeta.agentEye = agentEye;
    if (agentEyeColor) nextMeta.agentEyeColor = agentEyeColor;

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { name, slug, metadata: nextMeta },
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

  if (intent === "updateAgentEye") {
    const agentEye = (formData.get("agentEye") as string)?.trim();
    const agentEyeColor = (formData.get("agentEyeColor") as string)?.trim();
    if (!agentEye || !agentEyeColor) {
      return json({ error: "Missing eye or color" }, { status: 400 });
    }
    const existing = await prisma.workspace.findFirst({
      where: { id: workspaceId },
      select: { metadata: true },
    });
    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { metadata: { ...existingMeta, agentEye, agentEyeColor } },
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
    agentEye: savedAgentEye,
    agentEyeColor: savedAgentEyeColor,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const updateFetcher = useFetcher<{ error?: string; success?: boolean }>();
  const [confirmName, setConfirmName] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [agentEye, setAgentEye] = useState(savedAgentEye);
  const [agentEyeColor, setAgentEyeColor] = useState(savedAgentEyeColor);

  const isDeleting = fetcher.state === "submitting";
  const canDelete = confirmName === workspace.name;
  const isSaving = updateFetcher.state === "submitting";
  const hasChanges =
    name !== workspace.name ||
    slug !== workspace.slug ||
    agentEye !== savedAgentEye ||
    agentEyeColor !== savedAgentEyeColor;

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
              <CardContent className="flex flex-col gap-5 p-4">
                {/* Live preview */}
                <div className="flex items-center gap-4">
                  <SamAvatar size={72} eye={agentEye} eyeColor={agentEyeColor} />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{name || "Butler"}</span>
                    <span className="text-muted-foreground text-xs">
                      {SAM_EYE_OPTIONS.find((o) => o.id === agentEye)?.label ?? agentEye}
                    </span>
                  </div>
                </div>

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

                {/* Mood (eye pattern) */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Mood</label>
                  <div className="grid grid-cols-6 gap-2">
                    {SAM_EYE_OPTIONS.map((opt) => {
                      const selected = agentEye === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          title={opt.desc}
                          onClick={() => setAgentEye(opt.id)}
                          className={cn(
                            "bg-background flex flex-col items-center gap-1 rounded-md border-2 p-2 transition-all hover:scale-[1.03] focus:outline-none",
                            selected
                              ? "border-primary"
                              : "border-transparent hover:border-border",
                          )}
                        >
                          <SamAvatar size={40} eye={opt.id} eyeColor={agentEyeColor} />
                          <span className="text-muted-foreground text-[10px]">
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Color */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {SAM_EYE_COLOR_OPTIONS.map((opt) => {
                      const selected = agentEyeColor === opt.hex;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          title={opt.label}
                          onClick={() => setAgentEyeColor(opt.hex)}
                          className={cn(
                            "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none",
                            selected ? "border-border" : "border-transparent",
                          )}
                          style={{ backgroundColor: opt.hex }}
                        />
                      );
                    })}
                  </div>
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
                        {
                          intent: "update",
                          name,
                          slug,
                          agentEye,
                          agentEyeColor,
                        },
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
