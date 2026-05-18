import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, FolderOpen, Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

interface GatewayListItem {
  id: string;
  name: string;
  hostname?: string | null;
  platform?: string | null;
  status: "CONNECTED" | "DISCONNECTED";
}

interface GatewayFolder {
  id: string;
  name: string;
  path: string;
  scopes: Array<"files" | "coding" | "exec">;
  gitRepo?: boolean;
}

interface GatewayInfo {
  gateway: { id: string; name: string; hostname?: string; platform?: string };
  folders: GatewayFolder[];
  agents: string[];
}

interface CreatedArgs {
  /// CodingSession.id
  id: string;
  /// Task the session is linked to. When taskId was not supplied as a
  /// prop, this is the stub task the spawn endpoint created.
  taskId: string;
  agent: string;
  dir: string;
  gatewayId: string;
  externalSessionId: string | null;
  prompt: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /// When omitted, the spawn endpoint creates a stub Task and returns
  /// its id via `onCreated.taskId`. The command-bar uses this mode.
  taskId?: string;
  taskTitle?: string;
  taskDescription?: string | null;
  /// Pre-select the gateway when set (the row stays editable — used by
  /// the command-bar to default to the row the user picked).
  initialGatewayId?: string;
  /// Pre-select the coding agent when set; row stays editable.
  initialAgent?: string;
  onCreated: (args: CreatedArgs) => void;
}

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

const CUSTOM_FOLDER_ID = "__custom__";

export function NewSessionDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
  taskDescription,
  initialGatewayId,
  initialAgent,
  onCreated,
}: Props) {
  const [gateways, setGateways] = useState<GatewayListItem[] | null>(null);
  const [gatewaysError, setGatewaysError] = useState<string | null>(null);

  const [selectedGatewayId, setSelectedGatewayId] = useState<string>("");
  const [info, setInfo] = useState<GatewayInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [selectedAgent, setSelectedAgent] = useState<string>("");

  // Custom-folder state (path + name + dirty bit for name auto-default).
  const [customPath, setCustomPath] = useState("");
  const [customName, setCustomName] = useState("");
  const [customNameDirty, setCustomNameDirty] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset when the dialog opens; load gateways.
  useEffect(() => {
    if (!open) return;
    setSelectedGatewayId(initialGatewayId ?? "");
    setInfo(null);
    setInfoError(null);
    setSelectedFolderId("");
    setSelectedAgent(initialAgent ?? "");
    setCustomPath("");
    setCustomName("");
    setCustomNameDirty(false);
    setRegisterError(null);
    setSubmitError(null);
    setGateways(null);
    setGatewaysError(null);

    (async () => {
      try {
        const res = await fetch("/api/v1/gateways");
        if (!res.ok) throw new Error(`list failed (${res.status})`);
        const body = (await res.json()) as { gateways: GatewayListItem[] };
        const connected = (body.gateways ?? []).filter(
          (g) => g.status === "CONNECTED",
        );
        setGateways(connected);
        if (!initialGatewayId && connected.length === 1) {
          setSelectedGatewayId(connected[0].id);
        }
      } catch (err) {
        setGatewaysError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [open, initialGatewayId, initialAgent]);

  // Fetch folders + agents for the selected gateway. Depends on `open`
  // too so reopening the dialog with the same gateway still refreshes —
  // otherwise the open-effect clears `info` but this effect wouldn't
  // re-run (selectedGatewayId didn't change), leaving folders and the
  // agent dropdown empty.
  useEffect(() => {
    if (!open) return;
    if (!selectedGatewayId) {
      setInfo(null);
      return;
    }
    setInfoLoading(true);
    setInfoError(null);
    setInfo(null);
    setSelectedFolderId("");

    (async () => {
      try {
        const res = await fetch(`/api/v1/gateways/${selectedGatewayId}/info`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `info failed (${res.status})`);
        }
        const data = (await res.json()) as GatewayInfo;
        setInfo(data);
        // Keep the pre-selected agent if this gateway offers it; otherwise
        // fall back to the first available. Covers both the initial open
        // (preserves `initialAgent` from command-bar) and gateway switches
        // (avoids leaving a stale agent that the new gateway doesn't have).
        setSelectedAgent((curr) => {
          if (curr && data.agents.includes(curr)) return curr;
          return data.agents[0] ?? "";
        });
      } catch (err) {
        setInfoError(err instanceof Error ? err.message : String(err));
      } finally {
        setInfoLoading(false);
      }
    })();
  }, [open, selectedGatewayId]);

  const codingFolders = useMemo(
    () => (info?.folders ?? []).filter((f) => f.scopes.includes("coding")),
    [info],
  );

  // Default to the first registered coding folder when info arrives and
  // the user hasn't picked anything yet. This way the form is
  // immediately submittable on gateways that already have a folder.
  useEffect(() => {
    if (selectedFolderId) return;
    if (codingFolders.length === 0) return;
    setSelectedFolderId(codingFolders[0].id);
  }, [codingFolders, selectedFolderId]);

  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
  const selectedFolder = useMemo(
    () => codingFolders.find((f) => f.id === selectedFolderId) ?? null,
    [codingFolders, selectedFolderId],
  );

  // When the user types a custom path, default the name to its basename
  // until they manually edit the name field.
  useEffect(() => {
    if (selectedFolderId !== CUSTOM_FOLDER_ID) return;
    if (customNameDirty) return;
    setCustomName(basename(customPath));
  }, [customPath, selectedFolderId, customNameDirty]);

  const dirToSubmit = useMemo(() => {
    if (selectedFolderId === CUSTOM_FOLDER_ID) {
      return customPath.trim();
    }
    if (!selectedFolderId) return "";
    const f = codingFolders.find((x) => x.id === selectedFolderId);
    return f?.path ?? "";
  }, [selectedFolderId, codingFolders, customPath]);

  const canSubmit =
    !submitting &&
    Boolean(selectedGatewayId) &&
    Boolean(selectedAgent) &&
    Boolean(dirToSubmit) &&
    (selectedFolderId !== CUSTOM_FOLDER_ID || customName.trim().length > 0);

  // Auto-built initial prompt for new sessions. Wrapped in <title> /
  // <description> blocks so the coding agent gets a clearly-delimited
  // brief, matching the singleton contract the description-update job
  // uses. Empty fields are skipped (no orphan tags). Returns null when
  // there's nothing to send — including the command-bar path where the
  // dialog opens without a task yet — so nothing gets typed into the
  // terminal.
  const buildInitialPrompt = (): string | null => {
    const blocks: string[] = [];
    if (taskTitle && taskTitle.trim()) {
      blocks.push(`<title>\n${taskTitle.trim()}\n</title>`);
    }
    if (taskDescription && taskDescription.trim()) {
      blocks.push(`<description>\n${taskDescription.trim()}\n</description>`);
    }
    if (blocks.length === 0) return null;
    return blocks.join("\n\n");
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    setRegisterError(null);
    // Resume flows live in ResumableGatewayTerminal, not this dialog —
    // every spawn here is a fresh session, so always send the brief.
    const prompt = buildInitialPrompt();
    let dir = dirToSubmit;

    try {
      // Custom folder: register it on the gateway first so the gateway
      // accepts the upcoming spawn (its folder-scope check would reject
      // an unknown path with "not inside a coding-scoped folder").
      if (selectedFolderId === CUSTOM_FOLDER_ID) {
        const regRes = await fetch(
          `/api/v1/gateways/${selectedGatewayId}/folders`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "local",
              path: dir,
              name: customName.trim(),
              scopes: ["coding"],
            }),
          },
        );
        if (!regRes.ok) {
          const body = (await regRes.json().catch(() => ({}))) as {
            error?: string;
          };
          const msg =
            body.error ?? `Failed to register folder (${regRes.status})`;
          setRegisterError(msg);
          throw new Error(msg);
        }
        const regBody = (await regRes.json()) as {
          folder?: { path?: string };
        };
        if (regBody.folder?.path) {
          dir = regBody.folder.path;
        }
      }

      const res = await fetch(`/api/v1/coding-sessions/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: selectedAgent,
          dir,
          gatewayId: selectedGatewayId,
          ...(taskId ? { taskId } : {}),
          ...(prompt ? { prompt } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `Failed to create session (${res.status})`,
        );
      }
      const data = (await res.json()) as {
        task: { id: string };
        session: {
          id: string;
          externalSessionId: string | null;
        };
      };
      onCreated({
        id: data.session.id,
        taskId: data.task.id,
        agent: selectedAgent,
        dir,
        gatewayId: selectedGatewayId,
        externalSessionId: data.session.externalSessionId ?? null,
        prompt,
      });
      onOpenChange(false);
    } catch (err) {
      // Avoid overwriting the more specific register error with a
      // generic "Failed to register folder" thrown after we already set it.
      if (!registerError) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New coding session</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Step 1 — Gateway */}
          <div className="flex flex-col gap-1.5">
            <label className="text-foreground text-sm font-medium">
              Gateway
            </label>
            {gatewaysError ? (
              <p className="text-destructive text-xs">{gatewaysError}</p>
            ) : null}
            <Select
              value={selectedGatewayId}
              onValueChange={setSelectedGatewayId}
              disabled={!gateways}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    gateways === null
                      ? "Loading gateways…"
                      : gateways.length === 0
                        ? "No connected gateways"
                        : "Select gateway…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {gateways?.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    <span className="font-medium">{g.name}</span>
                    {g.hostname ? (
                      <span className="text-muted-foreground ml-2 text-xs">
                        {g.hostname}
                        {g.platform ? ` · ${g.platform}` : ""}
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Step 2 — Folder (scoped to coding) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-foreground text-sm font-medium">
              Folder the agent can access
            </label>
            {!selectedGatewayId ? (
              <p className="text-muted-foreground text-xs">
                Pick a gateway to see its shared folders.
              </p>
            ) : infoLoading ? (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Loader2 size={12} className="animate-spin" />
                Loading folders…
              </p>
            ) : infoError ? (
              <p className="text-destructive text-xs">{infoError}</p>
            ) : (
              <Popover
                open={folderPopoverOpen}
                onOpenChange={setFolderPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    role="combobox"
                    aria-expanded={folderPopoverOpen}
                    className="w-full justify-between text-left font-normal"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      {selectedFolderId === CUSTOM_FOLDER_ID ? (
                        <>
                          <Plus
                            size={14}
                            className="text-muted-foreground shrink-0"
                          />
                          <span className="truncate">
                            Use a different folder…
                          </span>
                        </>
                      ) : selectedFolder ? (
                        <>
                          <FolderOpen
                            size={14}
                            className="text-muted-foreground shrink-0"
                          />
                          <span className="truncate font-medium">
                            {selectedFolder.name}
                          </span>
                          <span className="text-muted-foreground truncate font-mono text-xs">
                            {selectedFolder.path}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Pick a folder or use a different one…
                        </span>
                      )}
                    </span>
                    <ChevronsUpDown
                      size={14}
                      className="text-muted-foreground ml-2 shrink-0 opacity-60"
                    />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                >
                  <Command>
                    <CommandInput placeholder="Search folders…" />
                    <CommandList>
                      <CommandEmpty>
                        No matching folder. Pick "Use a different folder…" to
                        type one.
                      </CommandEmpty>
                      {codingFolders.length > 0 && (
                        <CommandGroup>
                          {codingFolders.map((f) => (
                            <CommandItem
                              key={f.id}
                              value={`${f.name} ${f.path}`}
                              onSelect={() => {
                                setSelectedFolderId(f.id);
                                setFolderPopoverOpen(false);
                              }}
                              className="flex items-center gap-2"
                            >
                              <FolderOpen
                                size={14}
                                className="text-muted-foreground shrink-0"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                <span className="font-medium">{f.name}</span>
                                <span className="text-muted-foreground ml-2 font-mono text-xs">
                                  {f.path}
                                </span>
                              </span>
                              {f.gitRepo ? (
                                <span className="text-muted-foreground shrink-0 text-[10px] uppercase tracking-wide">
                                  git
                                </span>
                              ) : null}
                              {selectedFolderId === f.id ? (
                                <Check size={14} className="shrink-0" />
                              ) : null}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                      <CommandSeparator />
                      {/* Always-visible "Use a different folder…" — cmdk
                          filters by `value`, so spelling out variants keeps
                          it discoverable when the user starts typing a path. */}
                      <CommandGroup>
                        <CommandItem
                          value="use a different folder custom path new"
                          onSelect={() => {
                            setSelectedFolderId(CUSTOM_FOLDER_ID);
                            setRegisterError(null);
                            setFolderPopoverOpen(false);
                          }}
                          className="flex items-center gap-2"
                        >
                          <Plus
                            size={14}
                            className="text-muted-foreground shrink-0"
                          />
                          <span className="flex-1">
                            Use a different folder…
                          </span>
                          {selectedFolderId === CUSTOM_FOLDER_ID ? (
                            <Check size={14} className="shrink-0" />
                          ) : null}
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}

            {selectedFolderId === CUSTOM_FOLDER_ID && (
              <div className="mt-1 flex flex-col gap-2 rounded border p-2">
                <div className="flex flex-col gap-1">
                  <Label
                    htmlFor="custom-folder-path"
                    className="text-xs font-medium"
                  >
                    Absolute path
                  </Label>
                  <Input
                    id="custom-folder-path"
                    value={customPath}
                    onChange={(e) => setCustomPath(e.target.value)}
                    placeholder="/Users/you/code/my-project"
                    className="font-mono text-xs"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label
                    htmlFor="custom-folder-name"
                    className="text-xs font-medium"
                  >
                    Name
                  </Label>
                  <Input
                    id="custom-folder-name"
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      setCustomNameDirty(true);
                    }}
                    placeholder="my-project"
                    className="text-xs"
                  />
                </div>
                <p className="text-muted-foreground text-[11px]">
                  Registered on the gateway with the <code>coding</code> scope
                  when the session starts.
                </p>
                {registerError ? (
                  <p className="text-destructive text-xs">{registerError}</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Step 3 — Coding agent */}
          <div className="flex flex-col gap-1.5">
            <label className="text-foreground text-sm font-medium">
              Coding agent
            </label>
            <Select
              value={selectedAgent}
              onValueChange={setSelectedAgent}
              disabled={!info || info.agents.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !selectedGatewayId
                      ? "Pick a gateway first"
                      : infoLoading
                        ? "Loading…"
                        : info?.agents.length === 0
                          ? "No agents configured on this gateway"
                          : "Select agent…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(info?.agents ?? []).map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {submitError ? (
            <p className="text-destructive text-xs">{submitError}</p>
          ) : null}
        </div>

        <DialogFooter className="border-none p-3 pt-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? "Starting…" : "Start session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
