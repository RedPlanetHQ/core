import { type Workspace } from "@prisma/client";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { AvatarText } from "~/components/ui/avatar";
import { ChevronDown, Check } from "lucide-react";

interface WorkspaceSelectorProps {
  workspaces: Workspace[];
  selectedWorkspace: Workspace | null;
  onWorkspaceChange: (workspace: Workspace) => void;
  label?: string;
}

export function WorkspaceSelector({
  workspaces,
  selectedWorkspace,
  onWorkspaceChange,
  label = "Workspace",
}: WorkspaceSelectorProps) {
  return (
    <div>
      <p className="text-muted-foreground mb-2 text-sm">{label}</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="xl"
            className="w-full justify-between px-2"
          >
            <div className="flex items-center gap-2">
              {selectedWorkspace && (
                <>
                  <AvatarText
                    text={selectedWorkspace.name}
                    className="h-5 w-5 rounded text-xs"
                  />
                  <span>{selectedWorkspace.name}</span>
                </>
              )}
            </div>
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-full min-w-[200px]">
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              className="flex items-center justify-between gap-2"
              onClick={() => onWorkspaceChange(workspace)}
            >
              <div className="flex items-center gap-2">
                <AvatarText
                  text={workspace.name}
                  className="h-5 w-5 rounded text-xs"
                />
                <span>{workspace.name}</span>
              </div>
              {workspace.id === selectedWorkspace?.id && (
                <Check size={14} className="text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
