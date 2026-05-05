import { useCallback, useRef, useState } from "react";
import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  ArrowLeft,
  Inbox,
  LoaderCircle,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { ClientOnly } from "remix-utils/client-only";
import {
  SkillEditor,
  type SkillEditorHandle,
  type SkillEditorMeta,
} from "~/components/editor/skill-editor.client";
import { Button } from "~/components/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { prisma } from "~/db.server";
import { getUser, getWorkspaceId } from "~/services/session.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.skill?.title;
  return [{ title: title ? `${title} | Skills` : "Skills" }];
};

function isPersonaSkill(skill: {
  source: string | null;
  metadata: unknown;
}): boolean {
  if (skill.source === "persona-v2") return true;
  const meta = (skill.metadata as Record<string, unknown> | null) ?? {};
  return meta.skillType === "persona";
}

function isDefaultSkill(skill: {
  source: string | null;
  metadata: unknown;
}): boolean {
  if (skill.source === "system" || skill.source === "persona-v2") return true;
  const meta = (skill.metadata as Record<string, unknown> | null) ?? {};
  return !!meta.skillType;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const workspaceId = await getWorkspaceId(request, user?.id as string);

  const skill = await prisma.document.findFirst({
    where: {
      id: params.skillId,
      workspaceId: workspaceId as string,
      type: "skill",
      deleted: null,
    },
  });

  let autoUpdatePersona = true;
  if (skill && isPersonaSkill(skill)) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId as string },
      select: { metadata: true },
    });
    const meta = (workspace?.metadata ?? {}) as Record<string, unknown>;
    autoUpdatePersona = meta.autoUpdatePersona !== false;
  }

  return json({
    skill,
    isPersona: skill ? isPersonaSkill(skill) : false,
    canDelete: skill ? !isDefaultSkill(skill) : false,
    autoUpdatePersona,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUser(request);
  const workspaceId = await getWorkspaceId(request, user?.id as string);

  if (!workspaceId) {
    return json({ error: "Workspace not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "setAutoUpdatePersona") {
    const skill = await prisma.document.findFirst({
      where: {
        id: params.skillId,
        workspaceId,
        type: "skill",
        deleted: null,
      },
      select: { source: true, metadata: true },
    });

    if (!skill || !isPersonaSkill(skill)) {
      return json({ error: "Not a persona skill" }, { status: 400 });
    }

    const enabled = formData.get("enabled") === "true";
    const existing = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { metadata: true },
    });
    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { metadata: { ...existingMeta, autoUpdatePersona: enabled } },
    });

    return json({ success: true, autoUpdatePersona: enabled });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
}

export default function SkillDetail() {
  const { skill, isPersona, canDelete, autoUpdatePersona } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const editorRef = useRef<SkillEditorHandle>(null);
  const [meta, setMeta] = useState<SkillEditorMeta>({
    isDirty: false,
    isSaving: false,
    isDeleting: false,
  });
  const [deleteOpen, setDeleteOpen] = useState(false);

  const personaToggleFetcher = useFetcher<{
    autoUpdatePersona?: boolean;
    error?: string;
  }>();

  const optimisticAutoUpdate =
    personaToggleFetcher.formData?.get("intent") === "setAutoUpdatePersona"
      ? personaToggleFetcher.formData.get("enabled") === "true"
      : autoUpdatePersona;

  const handleAutoUpdateChange = (enabled: boolean) => {
    personaToggleFetcher.submit(
      { intent: "setAutoUpdatePersona", enabled: String(enabled) },
      { method: "POST" },
    );
  };

  const handleMetaChange = useCallback((next: SkillEditorMeta) => {
    setMeta(next);
  }, []);

  if (!skill) {
    return (
      <div className="flex h-full w-full flex-col">
        <PageHeader
          title="Skill"
          actions={[
            {
              label: "Back",
              icon: <ArrowLeft size={14} />,
              onClick: () => navigate("/home/agent/skills"),
              variant: "ghost",
            },
          ]}
        />
        <div className="md:h-page flex h-[calc(100vh)] flex-col items-center justify-center gap-2 p-4">
          <Inbox size={30} />
          Skill not found
        </div>
      </div>
    );
  }

  const saveDisabled = !meta.isDirty || meta.isSaving;

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        onClick={() => editorRef.current?.save()}
        disabled={saveDisabled}
      >
        {meta.isSaving ? "Saving..." : "Save"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            aria-label="More options"
            disabled={meta.isDeleting}
          >
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {isPersona && (
            <DropdownMenuCheckboxItem
              checked={optimisticAutoUpdate}
              onCheckedChange={handleAutoUpdateChange}
              onSelect={(e) => e.preventDefault()}
            >
              Auto-update persona
            </DropdownMenuCheckboxItem>
          )}
          {isPersona && <DropdownMenuSeparator />}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={!canDelete}
            onSelect={(e) => {
              e.preventDefault();
              if (!canDelete) return;
              setDeleteOpen(true);
            }}
          >
            <Trash2 size={14} className="mr-2" />
            Delete skill
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <>
      <div className="h-page-xs flex flex-col">
        <PageHeader title="Edit skill" actionsNode={headerActions} />

        {isPersona && !optimisticAutoUpdate && (
          <div className="border-b border-gray-300 px-4 py-2">
            <p className="text-muted-foreground text-sm">
              Auto-update is off — this persona stays frozen until you turn it
              back on.
            </p>
          </div>
        )}

        <ClientOnly
          fallback={
            <div className="flex w-full justify-center">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            </div>
          }
        >
          {() => (
            <SkillEditor
              ref={editorRef}
              skill={{
                id: skill.id,
                title: skill.title,
                content: skill.content,
                metadata: skill.metadata as Record<string, unknown> | null,
                source: skill.source,
              }}
              onMetaChange={handleMetaChange}
            />
          )}
        </ClientOnly>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete skill</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this skill? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDeleteOpen(false);
                editorRef.current?.remove();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
