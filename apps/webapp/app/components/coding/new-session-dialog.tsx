import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
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
import { cn } from "~/lib/utils";
import { Checkbox } from "~/components/ui/checkbox";
import { Textarea } from "~/components/ui/textarea";
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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  taskId: string;
  taskTitle?: string;
  taskDescription?: string | null;
  onCreated: (args: {
    id: string;
    agent: string;
    dir: string;
    gatewayId: string;
    externalSessionId: string | null;
    prompt: string | null;
  }) => void;
}

export function NewSessionDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
  taskDescription,
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

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [sendInitialPrompt, setSendInitialPrompt] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState("");

  // Reset when the dialog opens; load gateways.
  useEffect(() => {
    if (!open) return;
    setSelectedGatewayId("");
    setInfo(null);
    setInfoError(null);
    setSelectedFolderId("");
    setSelectedAgent("");
    setSubmitError(null);
    setGateways(null);
    setGatewaysError(null);
    setSendInitialPrompt(false);
    setInitialPrompt("");

    (async () => {
      try {
        const res = await fetch("/api/v1/gateways");
        if (!res.ok) throw new Error(`list failed (${res.status})`);
        const body = (await res.json()) as { gateways: GatewayListItem[] };
        const connected = (body.gateways ?? []).filter(
          (g) => g.status === "CONNECTED",
        );
        setGateways(connected);
        if (connected.length === 1) setSelectedGatewayId(connected[0].id);
      } catch (err) {
        setGatewaysError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [open]);

  // Fetch folders + agents for the selected gateway.
  useEffect(() => {
    if (!selectedGatewayId) {
      setInfo(null);
      return;
    }
    setInfoLoading(true);
    setInfoError(null);
    setInfo(null);
    setSelectedFolderId("");
    setSelectedAgent("");

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
        if (data.agents.length > 0) setSelectedAgent(data.agents[0]);
      } catch (err) {
        setInfoError(err instanceof Error ? err.message : String(err));
      } finally {
        setInfoLoading(false);
      }
    })();
  }, [selectedGatewayId]);

  const codingFolders = useMemo(
    () => (info?.folders ?? []).filter((f) => f.scopes.includes("coding")),
    [info],
  );

  const dirToSubmit = useMemo(() => {
    if (!selectedFolderId) return "";
    const f = codingFolders.find((x) => x.id === selectedFolderId);
    return f?.path ?? "";
  }, [selectedFolderId, codingFolders]);

  const canSubmit =
    !submitting &&
    Boolean(selectedGatewayId) &&
    Boolean(selectedAgent) &&
    Boolean(dirToSubmit);

  const handleSendInitialPromptChange = (checked: boolean) => {
    setSendInitialPrompt(checked);
    if (checked && !initialPrompt) {
      const parts = [taskTitle, taskDescription].filter(Boolean);
      setInitialPrompt(parts.join("\n\n"));
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    const prompt =
      sendInitialPrompt && initialPrompt.trim() ? initialPrompt.trim() : null;
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/coding-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: selectedAgent,
          dir: dirToSubmit,
          gatewayId: selectedGatewayId,
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
        id: string;
        externalSessionId: string | null;
      };
      onCreated({
        id: data.id,
        agent: selectedAgent,
        dir: dirToSubmit,
        gatewayId: selectedGatewayId,
        externalSessionId: data.externalSessionId ?? null,
        prompt,
      });
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
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
            ) : codingFolders.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                This gateway has no coding-scoped folders. Add one with{" "}
                <code className="font-mono">corebrain folders add</code> on the
                gateway host.
              </p>
            ) : (
              <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto rounded border p-1">
                {codingFolders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedFolderId(f.id)}
                    className={cn(
                      "flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                      selectedFolderId === f.id
                        ? "bg-grayAlpha-100"
                        : "hover:bg-grayAlpha-100/50",
                    )}
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
                  </button>
                ))}
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

          {/* Initial prompt */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="send-initial-prompt"
                checked={sendInitialPrompt}
                onCheckedChange={(checked) =>
                  handleSendInitialPromptChange(checked === true)
                }
              />
              <Label
                htmlFor="send-initial-prompt"
                className="cursor-pointer text-sm font-medium"
              >
                Send initial prompt
              </Label>
            </div>
            {sendInitialPrompt && (
              <Textarea
                placeholder="Enter a prompt to send when the session starts…"
                value={initialPrompt}
                onChange={(e) => setInitialPrompt(e.target.value)}
                rows={3}
                className="resize-none text-sm"
              />
            )}
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
