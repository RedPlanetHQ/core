import { Button } from "../ui";
import { useLocation, useNavigate } from "@remix-run/react";
import { ChevronRight, Inbox, Network, Tag } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

export const Memory = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Collapsible defaultOpen className="px-2 mt-2">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 [&[data-state=open]>svg]:rotate-90">
        <h2 className="text-muted-foreground text-sm">Memory</h2>
        <ChevronRight size={16} className="text-muted-foreground transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="text-foreground flex flex-col gap-0.5">
          <div>
            <Button
              variant="secondary"
              className="gap-2"
              isActive={location.pathname.includes("/home/episode")}
              onClick={() => {
                navigate(`/home/episodes`);
              }}
            >
              <Inbox size={16} />
              Documents
            </Button>
          </div>
          <div>
            <Button
              variant="secondary"
              className="gap-2"
              isActive={location.pathname.includes("/home/graph")}
              onClick={() => {
                navigate(`/home/graph`);
              }}
            >
              <Network size={16} />
              My mind
            </Button>
          </div>
          <div>
            <Button
              variant="secondary"
              className="gap-2"
              isActive={location.pathname.includes("/home/label")}
              onClick={() => {
                navigate(`/home/labels/no_label`);
              }}
            >
              <Tag size={16} />
              Labels
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
