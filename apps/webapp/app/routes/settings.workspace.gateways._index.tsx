import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { Plus, Server, Trash2 } from "lucide-react";
import { SettingSection } from "~/components/setting-section";
import { Button } from "~/components/ui";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { RegisterGatewayDialog } from "~/components/gateway/register-dialog";

interface GatewayItem {
  id: string;
  name: string;
  description: string;
  status: "CONNECTED" | "DISCONNECTED";
  platform: string | null;
  hostname: string | null;
}

export default function WorkspaceGateways() {
  const navigate = useNavigate();
  const [gateways, setGateways] = useState<GatewayItem[] | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/gateways");
      if (!res.ok) return;
      const body = (await res.json()) as { gateways?: GatewayItem[] };
      setGateways(body.gateways ?? []);
    } catch {
      /* keep list on transient failure */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(`/api/v1/gateways/${id}`, { method: "DELETE" });
      await refresh();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Gateways"
        description="Locally-installed gateways that expose your files, coding sessions, and browser to CORE. Each connected gateway shows up as an agent."
        actions={
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setRegisterOpen(true)}
          >
            <Plus size={16} className="mr-2" />
            Register gateway
          </Button>
        }
      >
        {gateways && gateways.length === 0 && (
          <Card>
            <CardContent className="text-muted-foreground p-6 text-center text-sm">
              No gateways yet. Register one to expose local files, coding
              sessions, or a browser to CORE.
            </CardContent>
          </Card>
        )}

        {gateways &&
          gateways.map((g) => (
            <Card key={g.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => navigate(`/settings/workspace/gateways/${g.id}/files`)}
                >
                  <Server size={20} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{g.name}</span>
                      <Badge
                        variant={
                          g.status === "CONNECTED" ? "default" : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {g.status.toLowerCase()}
                      </Badge>
                    </div>
                    {(g.hostname || g.platform) && (
                      <p className="text-muted-foreground truncate text-xs">
                        {g.hostname}
                        {g.hostname && g.platform ? " · " : ""}
                        {g.platform}
                      </p>
                    )}
                  </div>
                </button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      title="Remove gateway"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove gateway</AlertDialogTitle>
                      <AlertDialogDescription>
                        The "{g.name}" gateway will be removed from this
                        workspace. The gateway process on your machine will
                        keep running until you stop it.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <Button
                        variant="destructive"
                        onClick={() => handleDelete(g.id)}
                        disabled={deleting === g.id}
                      >
                        {deleting === g.id ? "Removing..." : "Remove"}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ))}
      </SettingSection>

      <RegisterGatewayDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        onRegistered={() => {
          setRegisterOpen(false);
          refresh();
        }}
        trigger={null}
      />
    </div>
  );
}
