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
import { StyledMarkdown } from "~/components/common/styled-markdown";

interface LibrarySkillCardProps {
  skill: LibrarySkill;
  installedSkillId?: string;
  isInstalling?: boolean;
  isRemoving?: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}

function IntegrationLogos({
  skill,
}: {
  skill: LibrarySkill;
}) {
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

function SkillPreviewModal({
  skill,
  isOpen,
  onClose,
  installedSkillId,
  isInstalling,
  isRemoving,
  onInstall,
  onUninstall,
}: {
  skill: LibrarySkill;
  isOpen: boolean;
  onClose: () => void;
  installedSkillId?: string;
  isInstalling?: boolean;
  isRemoving?: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const isInstalled = !!installedSkillId;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[80vh] w-[90vw] max-w-4xl flex-col p-0">
        <DialogHeader className="border-b p-4 pb-3">
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="text-base font-medium">
              {skill.title}
            </DialogTitle>
            {isInstalled && (
              <Badge className="bg-green-100 text-xs text-green-800 rounded">
                <Check size={10} />
                Installed
              </Badge>
            )}
          </div>
          <IntegrationLogos skill={skill} />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <StyledMarkdown className="text-sm">{skill.content}</StyledMarkdown>
        </div>

        <div className="border-t p-4">
          {isInstalled ? (
            <Button
              variant="ghost"
              className="w-full rounded text-destructive hover:text-destructive"
              onClick={() => {
                onUninstall();
                onClose();
              }}
              disabled={isRemoving}
            >
              {isRemoving ? "Removing..." : "Remove"}
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="w-full rounded"
              onClick={() => {
                onInstall();
                onClose();
              }}
              disabled={isInstalling}
            >
              {isInstalling ? "Installing..." : "Install"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LibrarySkillCard({
  skill,
  installedSkillId,
  isInstalling,
  isRemoving,
  onInstall,
  onUninstall,
}: LibrarySkillCardProps) {
  const navigate = useNavigate();
  const isInstalled = !!installedSkillId;
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleCardClick = () => {
    if (isInstalled) {
      navigate(`/home/agent/skill/${installedSkillId}`);
    } else {
      setIsPreviewOpen(true);
    }
  };

  return (
    <>
      <Card
        className="flex cursor-pointer flex-col transition-all hover:border-primary/50"
        onClick={handleCardClick}
      >
        <CardHeader className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-center justify-between">
            <IntegrationLogos skill={skill} />
            {isInstalled && (
              <Badge className="bg-green-100 text-xs text-green-800 rounded shrink-0">
                <Check size={10} />
                Installed
              </Badge>
            )}
          </div>

          <CardTitle className="text-base font-medium">{skill.title}</CardTitle>
          <CardDescription className="flex-1 text-sm">
            {skill.shortDescription}
          </CardDescription>

          <div className="mt-auto pt-2">
            {isInstalled ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full rounded text-destructive hover:text-destructive"
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
                size="sm"
                className="w-full rounded"
                onClick={(e) => {
                  e.stopPropagation();
                  onInstall();
                }}
                disabled={isInstalling}
              >
                {isInstalling ? "Installing..." : "Install"}
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
        onInstall={onInstall}
        onUninstall={onUninstall}
      />
    </>
  );
}
