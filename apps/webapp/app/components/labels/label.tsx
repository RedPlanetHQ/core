import * as React from "react";
import { useFetcher } from "@remix-run/react";
import { DeleteLabelAlert } from "./delete-label-alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui";
import { Trash2, Edit, MoreVertical } from "lucide-react";

interface LabelProps {
  label: any;
  setEditLabelState: (labelId: string) => void;
  onDelete?: () => void;
}

export function Label({ label, setEditLabelState, onDelete }: LabelProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [deleteAlert, setDeleteAlert] = React.useState(false);

  React.useEffect(() => {
    if (fetcher.data?.success) {
      onDelete?.();
      setDeleteAlert(false);
    }
  }, [fetcher.data, onDelete]);

  const deleteLabelAPI = () => {
    const formData = new FormData();
    formData.append("intent", "delete");
    formData.append("labelId", label.id);

    fetcher.submit(formData, { method: "post" });
  };

  return (
    <div className="group bg-background-3 mb-2 flex justify-between rounded-lg p-2 px-4">
      <div className="flex items-center justify-center gap-3">
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: label.color }}
        ></div>
        <div>{label.name}</div>
      </div>

      <div className="items-center justify-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild className="flex items-center">
            <Button variant="ghost" className="flex items-center">
              <MoreVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditLabelState(label.id)}>
              <div className="flex items-center gap-1">
                <Edit size={16} /> Edit
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDeleteAlert(true)}>
              <div className="flex items-center gap-1">
                <Trash2 size={16} /> Delete
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DeleteLabelAlert
        open={deleteAlert}
        setOpen={setDeleteAlert}
        deleteLabel={deleteLabelAPI}
      />
    </div>
  );
}
