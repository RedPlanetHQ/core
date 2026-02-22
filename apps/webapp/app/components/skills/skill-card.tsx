import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { type SkillItem } from "~/hooks/use-skills";
import { useNavigate } from "@remix-run/react";
import { Library } from "lucide-react";
import { format, isThisYear } from "date-fns";

interface SkillCardProps {
  skill: SkillItem;
}

export function SkillCard({ skill }: SkillCardProps) {
  const navigate = useNavigate();

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return isThisYear(date)
      ? format(date, "MMM d")
      : format(date, "MMM d, yyyy");
  };

  // Truncate content for preview
  const PREVIEW_WORD_LIMIT = 30;
  const words = skill.content.split(/\s+/);
  const isLong = words.length > PREVIEW_WORD_LIMIT;
  const previewText = isLong
    ? words.slice(0, PREVIEW_WORD_LIMIT).join(" ") + "..."
    : skill.content;

  return (
    <div className="flex w-full items-center">
      <div
        className={cn(
          "group-hover:bg-grayAlpha-100 flex min-w-[0px] shrink grow items-start gap-2 rounded-md px-2 cursor-pointer",
        )}
        onClick={() => {
          navigate(`/home/agent/skill/${skill.id}`);
        }}
      >
        <div className="border-border flex w-full min-w-[0px] shrink flex-col gap-1 border-b py-2">
          <div className={cn("flex w-full min-w-[0px] shrink flex-col")}>
            <div className="flex w-full items-center gap-4">
              <div className="inline-flex min-h-[24px] min-w-[0px] shrink items-center justify-start gap-2">
                <Badge
                  className={cn(
                    "text-foreground shrink-0 rounded !bg-transparent px-0 text-sm",
                  )}
                >
                  <Library size={16} className="text-primary" />
                </Badge>

                <div className={cn("truncate text-left font-medium")}>
                  {skill.title}
                </div>
              </div>

              <div className="flex grow gap-1"></div>

              <div className="text-muted-foreground flex shrink-0 items-center justify-center gap-2 text-sm">
                <Badge
                  className={cn(
                    "!bg-grayAlpha-100 text-muted-foreground rounded text-sm",
                  )}
                >
                  {skill.source}
                </Badge>

                <div className="text-muted-foreground text-sm">
                  {formatDate(skill.createdAt)}
                </div>
              </div>
            </div>

            <div className="text-muted-foreground mt-1 text-sm pl-6">
              {previewText}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
