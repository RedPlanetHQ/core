import { Button } from "../ui";
import { useNavigate } from "@remix-run/react";
import { ChevronRight, Clock, Library, Plug } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

export const Agent = () => {
  const navigate = useNavigate();

  return (
    <Collapsible defaultOpen className="px-2">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 [&[data-state=open]>svg]:rotate-90">
        <h2 className="text-muted-foreground text-sm">Agent</h2>
        <ChevronRight size={16} className="text-muted-foreground transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="text-foreground flex flex-col gap-0.5">
          <div>
            <Button
              variant="secondary"
              className="gap-2"
              onClick={() => {
                navigate(`/home/labels/no_label`);
              }}
            >
              <Clock size={16} />
              Reminders
            </Button>
          </div>
          <div>
            <Button
              variant="secondary"
              className="gap-2"
              onClick={() => {
                navigate(`/home/labels/no_label`);
              }}
            >
              <Library size={16} />
              Skills
            </Button>
          </div>
          <div>
            <Button
              variant="secondary"
              className="gap-2"
              onClick={() => {
                navigate(`/home/labels/no_label`);
              }}
            >
              <Plug size={16} />
              Connect
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
