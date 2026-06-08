import { useState } from "react";
import { Check } from "lucide-react";
import { useNavigate } from "@remix-run/react";
import { type LibrarySkill } from "~/lib/skills-library";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { getIcon, type IconType } from "~/components/icon-utils";
import { EditorContent, useEditor } from "@tiptap/react";
import { extensionsForConversation } from "../conversation/editor-extensions";

export interface GatewayPickerOption {
  id: string;
  name: string;
  status: string;
}

interface LibrarySkillCardProps {
  skill: LibrarySkill;
  /**
   * Gateway list for the picker. Only used when `skill.kind === "gateway"`.
   * Disconnected gateways are shown but disabled so the user can see why a
   * particular target isn't available.
   */
  gateways: GatewayPickerOption[];
  installedSkillId?: string;
  isInstalling?: boolean;
  isRemoving?: boolean;
  /** `gatewayId` is required for gateway-kind skills, omitted for policy. */
  onInstall: (gatewayId?: string) => void;
  onUninstall: () => void;
}

function IntegrationLogos({ skill }: { skill: LibrarySkill }) {
  return (
    <div className="flex items-center gap-1.5">
      {skill.integrations.map((integration) => {
        const Icon = getIcon(integration.slug as IconType);
        return (
          <TooltipProvider key={integration.slug}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={integration.optional ? "opacity-40" : ""}>
                  <Icon size={16} />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {integration.name}
                {integration.optional ? " (optional)" : ""}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </div>
  );
}

function GatewayPickerDialog({
  isOpen,
  gateways,
  onPick,
  onClose,
}: {
  isOpen: boolean;
  gateways: GatewayPickerOption[];
  onPick: (gatewayId: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install on which gateway?</DialogTitle>
        </DialogHeader>

        {gateways.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No gateways found in this workspace. Connect a gateway first, then
            try again.
          </p>
        ) : (
          <div className="flex flex-col gap-2 py-2">
            {gateways.map((g) => {
              const connected = g.status === "CONNECTED";
              return (
                <Button
                  key={g.id}
                  variant="secondary"
                  className="justify-between rounded"
                  disabled={!connected}
                  onClick={() => {
                    onPick(g.id);
                    onClose();
                  }}
                >
                  <span>{g.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {connected ? "Connected" : g.status.toLowerCase()}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SkillPreviewModal({
  skill,
  isOpen,
  onClose,
  installedSkillId,
  isInstalling,
  isRemoving,
  onInstallClick,
  onUninstall,
}: {
  skill: LibrarySkill;
  isOpen: boolean;
  onClose: () => void;
  installedSkillId?: string;
  isInstalling?: boolean;
  isRemoving?: boolean;
  /**
   * Called when the user clicks Install in the preview. The card itself
   * decides whether to open a gateway picker (for `kind: "gateway"` skills)
   * or to install immediately (for `kind: "policy"`).
   */
  onInstallClick: () => void;
  onUninstall: () => void;
}) {
  const isInstalled = !!installedSkillId;
  const editor = useEditor({
    extensions: [...extensionsForConversation],
    editable: false,
    content: skill.content,
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-8xl flex max-h-[80vh] !w-[50vw] flex-col p-0">
        <DialogHeader className="border-b p-4 pb-3">
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="text-base font-medium">
              {skill.title}
            </DialogTitle>
            {isInstalled && (
              <Badge className="text-success rounded bg-green-100 text-xs">
                <Check size={10} />
                Installed
              </Badge>
            )}
          </div>
          <IntegrationLogos skill={skill} />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 text-base">
          <EditorContent
            editor={editor}
            className="editor-container"
            defaultValue={skill.content}
          />
        </div>

        <div className="flex justify-end border-t p-2">
          {isInstalled ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive w-full rounded"
              onClick={() => {
                onUninstall();
                onClose();
              }}
              size="lg"
              disabled={isRemoving}
            >
              {isRemoving ? "Removing..." : "Remove"}
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="rounded"
              size="lg"
              onClick={() => {
                onInstallClick();
                onClose();
              }}
              disabled={isInstalling}
            >
              {isInstalling
                ? "Installing..."
                : skill.kind === "gateway"
                  ? "Install on gateway…"
                  : "Install"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LibrarySkillCard({
  skill,
  gateways,
  installedSkillId,
  isInstalling,
  isRemoving,
  onInstall,
  onUninstall,
}: LibrarySkillCardProps) {
  const navigate = useNavigate();
  const isInstalled = !!installedSkillId;
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const handleCardClick = () => {
    if (isInstalled) {
      navigate(`/home/agent/skills/${installedSkillId}`);
    } else {
      setIsPreviewOpen(true);
    }
  };

  // Single entry point for both Install buttons (card + preview modal).
  // Gateway-kind skills need a target gateway → open the picker. Policy
  // skills just install straight into the workspace.
  const handleInstallClick = () => {
    if (skill.kind === "gateway") {
      setIsPickerOpen(true);
    } else {
      onInstall();
    }
  };

  return (
    <>
      <Card
        className="hover:border-primary/50 flex cursor-pointer flex-col transition-all"
        onClick={handleCardClick}
      >
        <CardHeader className="flex flex-1 flex-col gap-0 p-4">
          <div className="flex items-center justify-between">
            <IntegrationLogos skill={skill} />
            {isInstalled && (
              <Badge className="text-success shrink-0 rounded bg-green-100 text-xs">
                <Check size={10} />
                Installed
              </Badge>
            )}
          </div>

          <CardTitle className="text-md font-medium">{skill.title}</CardTitle>
          <CardDescription className="line-clamp-3 flex-1 text-sm">
            {skill.shortDescription}
          </CardDescription>

          <div className="mt-auto flex justify-end pt-2">
            {isInstalled ? (
              <Button
                variant="destructive"
                className="rounded"
                onClick={(e) => {
                  e.stopPropagation();
                  onUninstall();
                }}
                disabled={isRemoving}
              >
                {isRemoving ? "Removing..." : "Remove"}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="rounded"
                onClick={(e) => {
                  e.stopPropagation();
                  handleInstallClick();
                }}
                disabled={isInstalling}
              >
                {isInstalling
                  ? "Installing..."
                  : skill.kind === "gateway"
                    ? "Install on gateway…"
                    : "Install"}
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      <SkillPreviewModal
        skill={skill}
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        installedSkillId={installedSkillId}
        isInstalling={isInstalling}
        isRemoving={isRemoving}
        onInstallClick={handleInstallClick}
        onUninstall={onUninstall}
      />

      <GatewayPickerDialog
        isOpen={isPickerOpen}
        gateways={gateways}
        onClose={() => setIsPickerOpen(false)}
        onPick={(gatewayId) => onInstall(gatewayId)}
      />
    </>
  );
}
