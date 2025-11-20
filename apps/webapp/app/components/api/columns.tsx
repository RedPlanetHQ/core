import { useFetcher } from "@remix-run/react";
import { type ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { Button } from "../ui";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import React from "react";
import { Trash } from "lucide-react";

export interface PersonalAccessToken {
  name: string;
  id: string;
  obfuscatedToken: string;
  lastAccessedAt: Date | null;
  createdAt: Date;
}

export const useTokensColumns = (): Array<ColumnDef<PersonalAccessToken>> => {
  const fetcher = useFetcher();
  const [open, setOpen] = React.useState(false);

  const onDelete = (id: string) => {
    fetcher.submit({ id }, { method: "DELETE", action: "/settings/api" });
    setOpen(false);
  };

  return [
    {
      accessorKey: "name",
      header: () => {
        return <span>Name</span>;
      },
      cell: ({ row }) => {
        return (
          <div className="py-2capitalize flex items-center gap-1 py-2">
            {row.original.name}
          </div>
        );
      },
    },
    {
      accessorKey: "obfuscatedToken",
      header: () => {
        return <span>Token</span>;
      },
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-1 text-sm">
            {row.original.obfuscatedToken}
          </div>
        );
      },
    },
    {
      accessorKey: "lastAccessedAt",
      header: () => {
        return <span>Last accessed</span>;
      },
      cell: ({ row }) => {
        return (
          <div className="flex min-w-[200px] items-center gap-1 text-sm">
            {row.original.lastAccessedAt
              ? format(row.original.lastAccessedAt, "MMM d, yyyy")
              : "Never"}
          </div>
        );
      },
    },
    {
      accessorKey: "actions",
      header: () => {
        return <span>Actions</span>;
      },
      cell: ({ row }) => {
        return (
          <Dialog onOpenChange={setOpen} open={open}>
            <DialogTrigger asChild>
              <Button variant="ghost">
                <Trash size={14} />
              </Button>
            </DialogTrigger>
            <DialogContent className="p-3">
              <DialogHeader>
                <DialogTitle>Are you sure?</DialogTitle>
                <DialogDescription>
                  This action cannot be undone. This will permanently delete
                  your API token.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => onDelete(row.original.id)}
                >
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      },
    },
  ];
};
