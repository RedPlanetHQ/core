import { Library, LoaderCircle, Plus } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { useSkills } from "~/hooks/use-skills";
import { VirtualSkillsList } from "~/components/skills/virtual-skills-list";
import { Card, CardContent } from "~/components/ui/card";
import { useNavigate } from "@remix-run/react";

export default function Skills() {
  const navigate = useNavigate();
  const { skills, hasMore, loadMore, isLoading, isInitialLoad } = useSkills();

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

      <div className="flex h-[calc(100vh)] w-full flex-col items-center space-y-6 pt-3 md:h-[calc(100vh_-_56px)]">
        {isInitialLoad ? (
          <LoaderCircle className="text-primary h-4 w-4 animate-spin" />
        ) : (
          <div className="flex h-full w-full space-y-4 pb-2">
            {!skills || skills.length === 0 ? (
              <Card className="bg-background-2 w-full">
                <CardContent className="bg-background-2 flex w-full items-center justify-center py-16">
                  <div className="text-center">
                    <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
                      <Library className="text-primary h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-semibold">No skills yet</h3>
                    <p className="text-muted-foreground">
                      Create your first skill to add custom automations and
                      workflows.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <VirtualSkillsList
                skills={skills}
                hasMore={hasMore}
                loadMore={loadMore}
                isLoading={isLoading}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
