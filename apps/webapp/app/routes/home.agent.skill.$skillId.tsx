import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { ArrowLeft, Inbox, LoaderCircle } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import { ClientOnly } from "remix-utils/client-only";
import { SkillEditor } from "~/components/editor/skill-editor.client";
import { prisma } from "~/db.server";
import { getUser, getWorkspaceId } from "~/services/session.server";

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

  return json({ skill });
}

export default function SkillDetail() {
  const { skill } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

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
        <div className="flex h-[calc(100vh)] flex-col items-center justify-center gap-2 p-4 md:h-[calc(100vh_-_56px)]">
          <Inbox size={30} />
          Skill not found
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="episode-details flex h-full flex-col">
        <PageHeader title="Edit skill" />

        <ClientOnly
          fallback={
            <div className="flex w-full justify-center">
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            </div>
          }
        >
          {() => {
            return (
              <SkillEditor
                skill={{
                  id: skill.id,
                  title: skill.title,
                  content: skill.content,
                  metadata: skill.metadata as Record<string, unknown> | null,
                }}
              />
            );
          }}
        </ClientOnly>
      </div>
    </>
  );
}
