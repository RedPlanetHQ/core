import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import { Tag, Plus, FileText } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { withOpacity } from "~/lib/color-utils";
import { LabelService } from "~/services/label.server";
import { getUser, getWorkspaceId } from "~/services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const workspaceId = await getWorkspaceId(request, user?.id as string);
  const labelService = new LabelService();

  try {
    const labels = await labelService.getWorkspaceLabelsWithCounts(
      workspaceId as string,
    );
    return json({ labels });
  } catch (e) {
    return json({ labels: [] });
  }
}

export default function LabelsIndex() {
  const { labels } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  console.log(labels)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Labels"
        actions={[
          {
            label: "New label",
            icon: <Plus size={14} />,
            onClick: () => navigate("/settings/labels"),
            variant: "secondary",
          },
        ]}
      />

      <div className="flex h-[calc(100vh)] w-full flex-col p-4 md:h-[calc(100vh_-_56px)]">
        {labels.length === 0 ? (
          <div className="mt-20 flex flex-col items-center justify-center">
            <Tag className="text-muted-foreground mb-2 h-6 w-6" />
            <h3 className="text-lg">No labels found</h3>
            <p className="text-muted-foreground text-sm">
              Create labels to organize your documents
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {labels.map((label) => (
              <Link
                key={label.id}
                to={`/home/labels/${label.id}`}
                className="bg-background-3 h-full rounded-lg"
              >
                <Card className="transition-all hover:border-primary/50">
                  <CardHeader className="p-4">
                    <div className="flex items-center justify-between">
                      <div
                        className="mb-2 flex h-6 w-6 items-center justify-center rounded"
                        style={{ backgroundColor: withOpacity(label.color, 0.12) }}
                      >
                        <Tag size={14} style={{ color: label.color }} />
                      </div>
                      <div className="text-muted-foreground flex items-center gap-1 text-sm">
                        <FileText size={12} />
                        <span>{label.documentCount}</span>
                      </div>
                    </div>
                    <CardTitle className="text-base">{label.name}</CardTitle>
                    <CardDescription className="line-clamp-2 text-sm">
                      {label.description || "No description"}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
