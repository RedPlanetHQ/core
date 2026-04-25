import React, { createContext, useContext, useState } from "react";
import {
  Globe,
  History,
  Loader2,
  MousePointerClick,
  Play,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverPortal,
} from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

export type BrowserSessionItem = {
  name: string;
  profile: string;
  live: boolean;
  lock: {
    taskId: string;
    taskTitle: string | null;
    taskStatus: string | null;
    sessionName: string;
  } | null;
};

export type BrowserProfileItem = {
  name: string;
  dir?: string;
};

type BrowserActionsValue = {
  sessions: BrowserSessionItem[] | null;
  profiles: BrowserProfileItem[];
  selectedName: string | null;
  launchingName: string | null;
  loadError: string | null;
  launchError: string | null;
  onSelect: (name: string) => void;
  onLaunch: (name: string) => void;
  onCreate: (name: string, profile: string) => Promise<void>;
  onRefresh: () => void;
} | null;

const BrowserActionsContext = createContext<BrowserActionsValue>(null);
const SetBrowserActionsContext = createContext<
  React.Dispatch<React.SetStateAction<BrowserActionsValue>>
>(() => {});

export function BrowserActionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [value, setValue] = useState<BrowserActionsValue>(null);
  return (
    <SetBrowserActionsContext.Provider value={setValue}>
      <BrowserActionsContext.Provider value={value}>
        {children}
      </BrowserActionsContext.Provider>
    </SetBrowserActionsContext.Provider>
  );
}

export function useSetBrowserActions() {
  return useContext(SetBrowserActionsContext);
}

const LIST_MAX_HEIGHT = 420;

function CreateSessionForm({
  profiles,
  existingNames,
  onCreate,
  onCancel,
}: {
  profiles: BrowserProfileItem[];
  existingNames: Set<string>;
  onCreate: (name: string, profile: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [profile, setProfile] = useState(profiles[0]?.name ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const nameTaken = trimmed && existingNames.has(trimmed);
  const canSubmit = !!trimmed && !!profile && !nameTaken && !submitting;

  return (
    <form
      className="border-t bg-background-2 flex flex-col gap-2 p-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        try {
          await onCreate(trimmed, profile);
          setName("");
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="session name (e.g. flights)"
        className="h-7 text-xs"
        disabled={submitting}
      />
      <Select value={profile} onValueChange={setProfile} disabled={submitting}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="profile" />
        </SelectTrigger>
        <SelectContent>
          {profiles.map((p) => (
            <SelectItem key={p.name} value={p.name} className="text-xs">
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {nameTaken ? (
        <p className="text-destructive text-[11px]">
          A session named "{trimmed}" already exists.
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive text-[11px]">{error}</p>
      ) : null}
      <div className="flex gap-1.5">
        <Button
          type="submit"
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={!canSubmit}
        >
          {submitting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            "Create"
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function BrowserSessionsPopover({
  sessions,
  profiles,
  selectedName,
  launchingName,
  loadError,
  launchError,
  onSelect,
  onLaunch,
  onCreate,
}: {
  sessions: BrowserSessionItem[] | null;
  profiles: BrowserProfileItem[];
  selectedName: string | null;
  launchingName: string | null;
  loadError: string | null;
  launchError: string | null;
  onSelect: (name: string) => void;
  onLaunch: (name: string) => void;
  onCreate: (name: string, profile: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleSelect = (name: string) => {
    setOpen(false);
    onSelect(name);
  };

  const existingNames = new Set((sessions ?? []).map((s) => s.name));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="gap-2 rounded"
          title="Browser sessions"
        >
          <History size={14} />
          Sessions
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent align="end" className="w-80 p-0" side="bottom">
          <div
            className="overflow-y-auto"
            style={{ maxHeight: LIST_MAX_HEIGHT }}
          >
            {loadError ? (
              <p className="text-destructive p-3 text-xs">{loadError}</p>
            ) : sessions === null ? (
              <div className="text-muted-foreground flex items-center gap-2 p-3 text-xs">
                <Loader2 size={12} className="animate-spin" />
                Loading…
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-muted-foreground p-3 text-xs">
                No sessions yet — use the form below to create one.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5 p-1.5">
                {sessions.map((s) => {
                  const isSelected = s.name === selectedName;
                  return (
                    <li key={s.name}>
                      <button
                        type="button"
                        onClick={() => handleSelect(s.name)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm",
                          isSelected
                            ? "bg-grayAlpha-100"
                            : "hover:bg-grayAlpha-50",
                        )}
                      >
                        <Globe
                          size={14}
                          className="text-muted-foreground shrink-0"
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{s.name}</span>
                          <span className="text-muted-foreground truncate text-xs">
                            profile {s.profile}
                            {s.lock ? (
                              <>
                                {" · "}
                                <MousePointerClick
                                  size={10}
                                  className="-mt-0.5 mr-1 inline"
                                />
                                {s.lock.taskTitle ?? s.lock.taskId}
                              </>
                            ) : null}
                          </span>
                        </div>
                        {s.live ? (
                          <Badge variant="secondary" className="font-normal">
                            <span className="text-[10px]">live</span>
                          </Badge>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-6 gap-1 px-2"
                            disabled={launchingName === s.name}
                            onClick={(e) => {
                              e.stopPropagation();
                              onLaunch(s.name);
                            }}
                          >
                            {launchingName === s.name ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              <Play size={10} />
                            )}
                            <span className="text-[10px]">Launch</span>
                          </Button>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {launchError ? (
              <p className="text-destructive border-t p-3 text-xs">
                {launchError}
              </p>
            ) : null}
          </div>

          {creating ? (
            <CreateSessionForm
              profiles={profiles}
              existingNames={existingNames}
              onCreate={async (name, profile) => {
                await onCreate(name, profile);
                setCreating(false);
              }}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-9 w-full justify-start gap-1.5 rounded-none border-t text-xs"
              onClick={() => setCreating(true)}
              disabled={profiles.length === 0}
            >
              <Plus size={12} />
              {profiles.length === 0
                ? "Create profile first to add a session"
                : "Create session"}
            </Button>
          )}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

export function BrowserActions() {
  const ctx = useContext(BrowserActionsContext);
  if (!ctx) return null;

  return (
    <>
      <BrowserSessionsPopover
        sessions={ctx.sessions}
        profiles={ctx.profiles}
        selectedName={ctx.selectedName}
        launchingName={ctx.launchingName}
        loadError={ctx.loadError}
        launchError={ctx.launchError}
        onSelect={ctx.onSelect}
        onLaunch={ctx.onLaunch}
        onCreate={ctx.onCreate}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="Refresh sessions"
        onClick={ctx.onRefresh}
      >
        <RefreshCcw size={13} />
      </Button>
    </>
  );
}
