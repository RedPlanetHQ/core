import React from "react";
import { NewLabel } from "~/components/labels/new-label";
import { EditLabel } from "~/components/labels/edit-label";
import { Label as LabelComponent } from "~/components/labels/label";
import { SettingSection } from "~/components/setting-section";
import { Button, Input } from "~/components/ui";
import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";

import { LabelService } from "~/services/label.server";
import { requireUser } from "~/services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const {workspaceId} = await requireUser(request);


  if (!workspaceId) {
    throw new Error("Workspace not found");
  }

  const labelService = new LabelService();
  const labels = await labelService.getWorkspaceLabels(workspaceId);

  return json({ labels });
}

export async function action({ request }: ActionFunctionArgs) {
  const {workspaceId} = await requireUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent");


  if (!workspaceId) {
    throw json({ error: "Workspace not found" }, { status: 404 });
  }

  const labelService = new LabelService();

  try {
    switch (intent) {
      case "create": {
        const name = formData.get("name") as string;
        const description = formData.get("description") as string | undefined;
        const color = formData.get("color") as string;

        if (!name) {
          return json({ error: "Label name is required" }, { status: 400 });
        }

        const label = await labelService.createLabel({
          name,
          description,
          workspaceId,
          color,
        });

        return json({ success: true, label });
      }

      case "update": {
        const labelId = formData.get("labelId") as string;
        const name = formData.get("name") as string;
        const description = formData.get("description") as string | undefined;

        if (!labelId || !name) {
          return json(
            { error: "Label ID and name are required" },
            { status: 400 },
          );
        }

        const label = await labelService.updateLabel(
          labelId,
          { name, description },
          workspaceId,
        );

        return json({ success: true, label });
      }

      case "delete": {
        const labelId = formData.get("labelId") as string;

        if (!labelId) {
          return json({ error: "Label ID is required" }, { status: 400 });
        }

        await labelService.deleteLabel(labelId);

        return json({ success: true });
      }

      default:
        return json({ error: "Invalid intent" }, { status: 400 });
    }
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "An error occurred" },
      { status: 400 },
    );
  }
}

export default function Labels() {
  const { labels } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const [searchValue, setSearchValue] = React.useState("");
  const [showNewLabelCreation, setNewLabelCreation] = React.useState(false);
  const [editLabelState, setEditLabelState] = React.useState<
    string | undefined
  >(undefined);

  return (
    <div className="mx-auto flex w-auto flex-col gap-4 px-4 py-6 md:w-3xl">
      <SettingSection
        title="Labels"
        description="Use labels and label groups to help organize and filter episodes in your workspace."
      >
        <div className="flex flex-col">
          <div className="mb-4">
            <div className="flex justify-between">
              <div className="flex gap-3">
                <Button
                  disabled={showNewLabelCreation}
                  variant="secondary"
                  size="lg"
                  onClick={() => {
                    setNewLabelCreation(true);
                  }}
                >
                  New label
                </Button>
              </div>
              <div className="flex">
                <Input
                  placeholder="Filter by name"
                  onChange={(e) => setSearchValue(e.currentTarget.value)}
                />
              </div>
            </div>

            {showNewLabelCreation && (
              <div className="my-3">
                <NewLabel
                  onCancel={() => setNewLabelCreation(false)}
                  onSuccess={() => {
                    setNewLabelCreation(false);
                    revalidator.revalidate();
                  }}
                />
              </div>
            )}
          </div>

          <div>
            {labels
              .filter((label) =>
                label.name.toLowerCase().includes(searchValue.toLowerCase()),
              )
              .map((label) => {
                if (editLabelState === label.id) {
                  return (
                    <EditLabel
                      key={label.id}
                      label={label}
                      onCancel={() => setEditLabelState(undefined)}
                      onSuccess={() => {
                        setEditLabelState(undefined);
                        revalidator.revalidate();
                      }}
                    />
                  );
                }

                return (
                  <LabelComponent
                    key={label.id}
                    label={label}
                    setEditLabelState={(labelId) => setEditLabelState(labelId)}
                    onDelete={() => revalidator.revalidate()}
                  />
                );
              })}
          </div>
        </div>
      </SettingSection>
    </div>
  );
}
