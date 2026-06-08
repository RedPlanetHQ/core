import { useState, useEffect } from "react";
import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Library, LoaderCircle, Plus } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { useSkills } from "~/hooks/use-skills";
import { VirtualSkillsList } from "~/components/skills/virtual-skills-list";
import { LibrarySkillCard } from "~/components/skills/library-skill-card.client";
import { Card, CardContent } from "~/components/ui/card";
import { prisma } from "~/db.server";
import { getUser, getWorkspaceId } from "~/services/session.server";
import { createSkill, deleteSkill } from "~/services/skills.server";
import { listGateways } from "~/services/gateway/crud.server";
import { callTool } from "~/services/gateway/transport.server";
import {
  getLibrarySkills,
  groupSkillsByCategory,
  substituteSkillVariables,
  LIBRARY_REPO_URL,
  LIBRARY_SKILLS_PATH,
} from "~/lib/skills-library";
import { ClientOnly } from "remix-utils/client-only";

export const meta = () => [{ title: "Skills" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const workspaceId = await getWorkspaceId(request, user?.id as string);

  const libraryInstalls = await prisma.document.findMany({
    where: {
      workspaceId: workspaceId as string,
      type: "skill",
      source: "library",
      deleted: null,
    },
    select: { id: true, metadata: true },
  });

  const installedSlugs: Record<string, string> = {};
  for (const doc of libraryInstalls) {
    const meta = doc.metadata as any;
    if (meta?.librarySlug) {
      installedSlugs[meta.librarySlug] = doc.id;
    }
  }

  const librarySkills = await getLibrarySkills();

  // Used by the gateway picker in the Library tab when installing a
  // gateway-shape skill. Only `id`, `name`, and `status` go to the client —
  // the rest of the gateway record stays server-side.
  const gateways = (await listGateways(workspaceId as string)).map((g) => ({
    id: g.id,
    name: g.name,
    status: g.status,
  }));

  return json({ installedSlugs, librarySkills, gateways });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  const workspaceId = await getWorkspaceId(request, user?.id as string);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "install-library-skill") {
    const slug = formData.get("slug") as string;
    const gatewayId = (formData.get("gatewayId") as string | null) || null;

    const librarySkills = await getLibrarySkills();
    const skill = librarySkills.find((s) => s.slug === slug);
    if (!skill) return json({ error: "Skill not found" }, { status: 404 });

    let content = skill.content;
    const metadata: Record<string, unknown> = {
      shortDescription: skill.shortDescription,
      librarySlug: slug,
      kind: skill.kind,
    };

    if (skill.kind === "gateway") {
      if (!gatewayId) {
        return json(
          { error: "Pick a gateway to install this skill on" },
          { status: 400 },
        );
      }
      // Make sure the gateway belongs to the requesting workspace before we
      // touch it — `callTool` doesn't enforce tenancy itself.
      const gateway = await prisma.gateway.findFirst({
        where: { id: gatewayId, workspaceId: workspaceId as string },
        select: { id: true, name: true },
      });
      if (!gateway) {
        return json({ error: "Gateway not found" }, { status: 404 });
      }

      try {
        await callTool(gatewayId, "skill_install", {
          url: LIBRARY_REPO_URL,
          name: slug,
          subdir: `${LIBRARY_SKILLS_PATH}/${slug}`,
          force: true,
        });
      } catch (err) {
        return json(
          {
            error: `Gateway install failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
          { status: 502 },
        );
      }

      const gatewaySkillRoot = `~/.corebrain/skills/${slug}`;
      content = substituteSkillVariables(content, {
        gatewayId: gateway.id,
        gatewayName: gateway.name,
        gatewaySkillRoot,
      });

      metadata.gatewayId = gateway.id;
      metadata.gatewayName = gateway.name;
      metadata.gatewaySkillRoot = gatewaySkillRoot;
    }

    await createSkill(workspaceId as string, user?.id as string, {
      title: skill.title,
      content,
      source: "library",
      metadata,
    });

    return json({ success: true });
  }

  if (intent === "uninstall-library-skill") {
    const skillId = formData.get("skillId") as string;

    // If this install was paired with a gateway, best-effort remove the
    // bundle there before deleting the local record. We don't fail the
    // uninstall if the gateway is offline — the user can re-run a cleanup
    // later, and the local record going away is the user-visible signal.
    const doc = await prisma.document.findFirst({
      where: { id: skillId, workspaceId: workspaceId as string, deleted: null },
      select: { metadata: true },
    });
    const meta = (doc?.metadata ?? null) as {
      gatewayId?: string;
      librarySlug?: string;
    } | null;
    if (meta?.gatewayId && meta.librarySlug) {
      try {
        await callTool(meta.gatewayId, "skill_remove", {
          name: meta.librarySlug,
        });
      } catch {
        // swallow: see comment above
      }
    }

    await deleteSkill(skillId, workspaceId as string);
    return json({ success: true });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
}

export default function Skills() {
  const {
    installedSlugs: loaderInstalledSlugs,
    librarySkills,
    gateways,
  } = useLoaderData<typeof loader>();
  const libraryByCategory = groupSkillsByCategory(librarySkills);
  const navigate = useNavigate();
  const { skills, hasMore, loadMore, isLoading, isInitialLoad, reset } =
    useSkills();
  const fetcher = useFetcher<{ success: boolean }>();

  // Optimistically track pending operations
  const [activeTab, setActiveTab] = useState<"my-skills" | "library">(
    "my-skills",
  );
  const [pendingInstall, setPendingInstall] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  // Merge loader state with optimistic updates
  const installedSlugs = { ...loaderInstalledSlugs };

  const handleInstall = (slug: string, gatewayId?: string) => {
    setPendingInstall(slug);
    fetcher.submit(
      gatewayId
        ? { intent: "install-library-skill", slug, gatewayId }
        : { intent: "install-library-skill", slug },
      { method: "post" },
    );
  };

  const handleUninstall = (skillId: string, slug: string) => {
    setPendingRemove(slug);
    fetcher.submit(
      { intent: "uninstall-library-skill", skillId },
      { method: "post" },
    );
  };

  // When install/uninstall completes, clear pending state and re-sync My Skills list
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setPendingInstall(null);
      setPendingRemove(null);
      reset(); // re-fetch /api/v1/skills so My Skills tab stays in sync
    }
  }, [fetcher.state]);

  const tabs = [
    {
      label: "My Skills",
      value: "my-skills",
      isActive: activeTab === "my-skills",
      onClick: () => setActiveTab("my-skills"),
    },
    {
      label: "Library",
      value: "library",
      isActive: activeTab === "library",
      onClick: () => setActiveTab("library"),
    },
  ];

  return (
    <div className="h-page flex flex-col">
      <PageHeader
        title="Skills"
        tabs={tabs}
        actions={[
          {
            label: "Add skill",
            icon: <Plus size={14} />,
            onClick: () => navigate(`/home/agent/skills/new`),
            variant: "secondary",
          },
        ]}
      />

      <div className="!md:h-page flex h-[calc(100vh)] w-full flex-col space-y-4 p-3 px-2 pt-3">
        {activeTab === "my-skills" && (
          <div className="flex-1 overflow-hidden">
            {isInitialLoad ? (
              <div className="flex w-full justify-center pt-8">
                <LoaderCircle className="text-primary h-4 w-4 animate-spin" />
              </div>
            ) : !skills || skills.length === 0 ? (
              <Card className="bg-background-2 w-full">
                <CardContent className="bg-background-2 flex w-full items-center justify-center py-16">
                  <div className="text-center">
                    <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
                      <Library className="text-primary h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-semibold">No skills yet</h3>
                    <p className="text-muted-foreground">
                      Create your first skill or install one from the Library.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="h-full pb-2">
                <VirtualSkillsList
                  skills={skills}
                  hasMore={hasMore}
                  loadMore={loadMore}
                  isLoading={isLoading}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "library" && (
          <ClientOnly
            fallback={
              <div className="flex w-full justify-center">
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              </div>
            }
          >
            {() => (
              <div className="flex flex-1 justify-center overflow-y-auto px-5">
                <div className="w-full max-w-3xl space-y-5 pb-8">
                  {Object.entries(libraryByCategory).map(
                    ([category, skills]) => (
                      <div key={category} className="space-y-2">
                        <h3 className="text-muted-foreground/80 text-sm font-medium">
                          {category}
                        </h3>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                          {skills.map((skill) => (
                            <LibrarySkillCard
                              key={skill.slug}
                              skill={skill}
                              gateways={gateways}
                              installedSkillId={installedSlugs[skill.slug]}
                              isInstalling={pendingInstall === skill.slug}
                              isRemoving={pendingRemove === skill.slug}
                              onInstall={(gatewayId) =>
                                handleInstall(skill.slug, gatewayId)
                              }
                              onUninstall={() =>
                                handleUninstall(
                                  installedSlugs[skill.slug],
                                  skill.slug,
                                )
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}
          </ClientOnly>
        )}
      </div>
    </div>
  );
}
