import { useState, useEffect } from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Library, LoaderCircle, Plus } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { useSkills } from "~/hooks/use-skills";
import { VirtualSkillsList } from "~/components/skills/virtual-skills-list";
import { LibrarySkillCard } from "~/components/skills/library-skill-card";
import { Card, CardContent } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { prisma } from "~/db.server";
import { getUser, getWorkspaceId } from "~/services/session.server";
import { createSkill, deleteSkill } from "~/services/skills.server";
import {
  LIBRARY_SKILLS,
  LIBRARY_SKILLS_BY_CATEGORY,
} from "~/lib/skills-library";

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

  return json({ installedSlugs });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  const workspaceId = await getWorkspaceId(request, user?.id as string);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "install-library-skill") {
    const slug = formData.get("slug") as string;
    const skill = LIBRARY_SKILLS.find((s) => s.slug === slug);
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
  const { installedSlugs: loaderInstalledSlugs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { skills, hasMore, loadMore, isLoading, isInitialLoad, reset } = useSkills();
  const fetcher = useFetcher<{ success: boolean }>();

  // Optimistically track pending operations
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Skills"
        actions={[
          {
            label: "Add skill",
            icon: <Plus size={14} />,
            onClick: () => navigate(`/home/agent/skill/new`),
            variant: "secondary",
          },
        ]}
      />

      <div className="flex h-[calc(100vh)] w-full flex-col space-y-4 p-4 px-5 pt-3 md:h-[calc(100vh_-_56px)]">
        <Tabs defaultValue="my-skills" className="flex h-full flex-col">
          <TabsList className="w-fit">
            <TabsTrigger value="my-skills">My Skills</TabsTrigger>
            <TabsTrigger value="library">Library</TabsTrigger>
          </TabsList>

          {/* My Skills Tab */}
          <TabsContent value="my-skills" className="flex-1 overflow-hidden mt-4">
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
          </TabsContent>

          {/* Library Tab */}
          <TabsContent value="library" className="flex-1 overflow-y-auto mt-4">
            <div className="space-y-8 pb-8">
              {Object.entries(LIBRARY_SKILLS_BY_CATEGORY).map(
                ([category, skills]) => (
                  <div key={category} className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      {category}
                    </h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
