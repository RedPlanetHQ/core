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
import { getLibrarySkills, groupSkillsByCategory } from "~/lib/skills-library";
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

  return json({ installedSlugs, librarySkills });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  const workspaceId = await getWorkspaceId(request, user?.id as string);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "install-library-skill") {
    const slug = formData.get("slug") as string;
    const librarySkills = await getLibrarySkills();
    const skill = librarySkills.find((s) => s.slug === slug);
    if (!skill) return json({ error: "Skill not found" }, { status: 404 });

    await createSkill(workspaceId as string, user?.id as string, {
      title: skill.title,
      content: skill.content,
      source: "library",
      metadata: {
        shortDescription: skill.shortDescription,
        librarySlug: slug,
      },
    });

    return json({ success: true });
  }

  if (intent === "uninstall-library-skill") {
    const skillId = formData.get("skillId") as string;
    await deleteSkill(skillId, workspaceId as string);
    return json({ success: true });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
}

export default function Skills() {
  const { installedSlugs: loaderInstalledSlugs, librarySkills } =
    useLoaderData<typeof loader>();
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

  const handleInstall = (slug: string) => {
    setPendingInstall(slug);
    fetcher.submit(
      { intent: "install-library-skill", slug },
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
    <div className="flex h-full flex-col">
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
                              installedSkillId={installedSlugs[skill.slug]}
                              isInstalling={pendingInstall === skill.slug}
                              isRemoving={pendingRemove === skill.slug}
                              onInstall={() => handleInstall(skill.slug)}
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
