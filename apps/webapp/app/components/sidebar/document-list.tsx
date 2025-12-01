import { Accordion } from "@radix-ui/react-accordion";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { TeamIcon } from "../ui/team-icon";
import { ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { type Label } from "@prisma/client";

interface DocumentListProps {
  labels: Label[];
}

export const DocumentList = ({ labels }: DocumentListProps) => {
  if (!labels || labels.length === 0) {
    return null;
  }

  return (
    <div className="px-2">
      <h2 className="text-muted-foreground mb-2 py-1"> Documents </h2>
      <Accordion
        type="single"
        collapsible
        className="flex w-full flex-col gap-2"
      >
        {labels.map((label: Label, index: number) => {
          return (
            <AccordionItem value={label.name} key={index} className="mb-1">
              <AccordionTrigger className="flex w-fit min-w-0 justify-between rounded-md [&[data-state=open]>div>div>svg]:rotate-90">
                <div className="flex w-full items-center justify-start gap-2">
                  <div>
                    <TeamIcon name={label.name} color={label.color} />
                  </div>

                  <div className="flex min-w-0 items-center justify-center gap-1">
                    <Tooltip>
                      <TooltipTrigger className="truncate">
                        {label.name}
                      </TooltipTrigger>

                      <TooltipContent className="p-2">
                        <p className="text-xs">{label.name}</p>
                      </TooltipContent>
                    </Tooltip>
                    <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200" />
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="my-2 flex w-full flex-col items-start justify-center">
                <h2>asdf</h2>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
};
