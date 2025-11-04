import { Calendar } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import { useNavigate } from "@remix-run/react";
import { StyledMarkdown } from "../common/styled-markdown";
import { SpaceEpisodeActions } from "./space-episode-actions";

export interface Episode {
  uuid: string;
  content: string;
  originalContent: string;
  source: any;
  createdAt: Date;
  validAt: Date;
  metadata: any;
  sessionId: any;
  logId?: any;
}

interface SpaceFactCardProps {
  episode: Episode;
  spaceId: string;
}

export function SpaceEpisodeCard({ episode, spaceId }: SpaceFactCardProps) {
  const navigate = useNavigate();
  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const displayText = episode.originalContent;

  const onClick = () => {
    navigate(`/home/episode/${episode.logId}`);
  };

  return (
    <>
      <div className="group flex w-full items-center px-5 pr-2">
        <div
          className={cn(
            "group-hover:bg-grayAlpha-100 flex min-w-[0px] shrink grow cursor-pointer items-start gap-2 rounded-md px-3",
          )}
          onClick={onClick}
        >
          <div
            className={cn(
              "border-border flex w-full min-w-[0px] shrink flex-col border-b py-1",
            )}
          >
            <div className="flex w-full items-center justify-between gap-4">
              <div className="inline-flex min-h-[24px] min-w-[0px] shrink items-center justify-start">
                <StyledMarkdown>{displayText.slice(0, 300)}</StyledMarkdown>
              </div>
              <div className="text-muted-foreground flex shrink-0 items-center justify-end gap-2 text-xs">
                <Badge variant="secondary" className="rounded text-xs">
                  <Calendar className="h-3 w-3" />
                  {formatDate(episode.validAt)}
                </Badge>
                <SpaceEpisodeActions
                  episodeId={episode.uuid}
                  spaceId={spaceId}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
