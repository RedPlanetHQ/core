import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useTauri } from "~/hooks/use-tauri";

interface AgentInfo {
  name: string;
  command: string;
  args: string[];
  resume_args: string[];
  is_default: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  taskId: string;
  defaultDir?: string;
  onCreated: (sessionId: string, agent: string, dir: string) => void;
}

export function NewSessionDialog({
  open,
  onOpenChange,
  taskId,
  defaultDir = "",
  onCreated,
}: Props) {
  const { invoke } = useTauri();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [dir, setDir] = useState(defaultDir);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    invoke<AgentInfo[]>("get_coding_agents").then((result) => {
      if (!result) return;
      setAgents(result);
      const def = result.find((a) => a.is_default) ?? result[0];
      if (def) setSelectedAgent(def.name);
    });
  }, [open, invoke]);

  useEffect(() => {
    setDir(defaultDir);
  }, [defaultDir]);

  const handleSubmit = async () => {
    if (!selectedAgent || !dir.trim()) return;
    setLoading(true);
    try {
      const gatewayId = await invoke<string>("get_gateway_id");
      const res = await fetch(`/api/v1/tasks/${taskId}/coding-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: selectedAgent,
          dir: dir.trim(),
          ...(gatewayId ? { gatewayId } : {}),
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = await res.json();
      onCreated(data.id, selectedAgent, dir.trim());
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New coding session</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-foreground text-sm font-medium">Agent</label>
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger>
                <SelectValue placeholder="Select agent…" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.name} value={a.name}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-foreground text-sm font-medium">
              Working directory
            </label>
            <Input
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder="/path/to/project"
              className="font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter className="border-none p-3 pt-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={handleSubmit}
            disabled={!selectedAgent || !dir.trim() || loading}
          >
            {loading ? "Starting…" : "Start session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
