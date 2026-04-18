import React, { createContext, useContext, useState } from "react";
import { Plus, History } from "lucide-react";
import { format } from "date-fns";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

type SessionItem = {
  id: string;
  agent: string;
  createdAt: Date;
  prompt: string | null;
};

type CodingActionsValue = {
  onNewSession: () => void;
  sessions: SessionItem[];
  selectedId: string | null;
  onSelectSession: (id: string) => void;
} | null;

const CodingActionsContext = createContext<CodingActionsValue>(null);
const SetCodingActionsContext = createContext<
  React.Dispatch<React.SetStateAction<CodingActionsValue>>
>(() => {});

export function CodingActionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [value, setValue] = useState<CodingActionsValue>(null);
  return (
    <SetCodingActionsContext.Provider value={setValue}>
      <CodingActionsContext.Provider value={value}>
        {children}
      </CodingActionsContext.Provider>
    </SetCodingActionsContext.Provider>
  );
}

export function useSetCodingActions() {
  return useContext(SetCodingActionsContext);
}

const ITEM_HEIGHT = 64;
const LIST_MAX_HEIGHT = 300;

function CodingSessionsPopover({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: SessionItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const handleSelect = (id: string) => {
    setOpen(false);
    onSelect(id);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="gap-2 rounded" title="Session history">
          <History size={14} />
          Sessions
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0" side="bottom">
        {sessions.length === 0 ? (
          <p className="text-muted-foreground px-3 py-3 text-xs">
            No sessions yet
          </p>
        ) : (
          <div
            className="overflow-y-auto"
            style={{ maxHeight: LIST_MAX_HEIGHT }}
          >
            {sessions.map((session) => (
              <div key={session.id} className="p-1 pb-0.5">
                <button
                  onClick={() => handleSelect(session.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors",
                    session.id === selectedId
                      ? "bg-grayAlpha-100"
                      : "hover:bg-grayAlpha-50",
                  )}
                  style={{ minHeight: ITEM_HEIGHT }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {format(new Date(session.createdAt), "MMM d")}
                      <span className="text-muted-foreground ml-1 text-xs font-normal">
                        {format(new Date(session.createdAt), "h:mm a")}
                      </span>
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {session.agent}
                    </Badge>
                  </div>
                  {session.prompt && (
                    <span className="text-muted-foreground line-clamp-2 text-xs">
                      {session.prompt.slice(0, 80)}
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function CodingActions() {
  const ctx = useContext(CodingActionsContext);
  if (!ctx) return null;

  return (
    <>
      <CodingSessionsPopover
        sessions={ctx.sessions}
        selectedId={ctx.selectedId}
        onSelect={ctx.onSelectSession}
      />
      <Button variant="secondary" onClick={ctx.onNewSession} className="gap-2">
        <Plus size={13} />
        New session
      </Button>
    </>
  );
}
