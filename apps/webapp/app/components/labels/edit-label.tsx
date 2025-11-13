import * as React from "react";
import { useFetcher } from "@remix-run/react";
import { Button, Input } from "../ui";

interface EditLabelProps {
  onCancel: () => void;
  onSuccess?: () => void;
  label: any;
}

export function EditLabel({ onCancel, label, onSuccess }: EditLabelProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [labelName, setLabelName] = React.useState(label.name);
  const [labelDescription, setLabelDescription] = React.useState(
    label.description || "",
  );

  const isLoading = fetcher.state !== "idle";

  React.useEffect(() => {
    if (fetcher.data?.success) {
      onSuccess?.();
    }
  }, [fetcher.data, onSuccess]);

  const onSubmit = async () => {
    if (!labelName.trim()) return;

    const formData = new FormData();
    formData.append("intent", "update");
    formData.append("labelId", label.id);
    formData.append("name", labelName.trim());
    if (labelDescription.trim()) {
      formData.append("description", labelDescription.trim());
    }

    fetcher.submit(formData, { method: "post" });
  };

  return (
    <div className="group bg-background-3 mb-2 flex flex-col gap-3 rounded p-4">
      <div className="flex items-center gap-3">
        <div
          className="h-3 w-3 flex-shrink-0 rounded-full"
          style={{ backgroundColor: label.color }}
        />
        <div className="flex-1">
          <Input
            value={labelName}
            className="w-full"
            onChange={(e) => setLabelName(e.target.value)}
            placeholder="Label name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
        </div>
      </div>

      <div>
        <Input
          value={labelDescription}
          className="w-full"
          onChange={(e) => setLabelDescription(e.target.value)}
          placeholder="Description (optional)"
        />
      </div>

      <div className="flex justify-end gap-4">
        <Button variant="outline" disabled={isLoading} onClick={onCancel}>
          Cancel
        </Button>
        <Button isLoading={isLoading} onClick={onSubmit}>
          Save
        </Button>
      </div>

      {fetcher.data?.error && (
        <div className="text-sm text-red-500">{fetcher.data.error}</div>
      )}
    </div>
  );
}
