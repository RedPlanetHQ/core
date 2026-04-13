import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { SettingSection } from "~/components/setting-section";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Checkbox } from "~/components/ui/checkbox";
import { AlertTriangle, Monitor } from "lucide-react";
import { useTauri } from "~/hooks/use-tauri";

interface ScreenContextSettings {
  paused: boolean;
  enabled_apps: string[];
}

interface RunningApp {
  name: string;
  icon: string | null; // loaded lazily
}

// ── Delete Data Dialog ────────────────────────────────────────────────────────

function DeleteDataDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const fetcher = useFetcher<{ deleted?: number; error?: string }>();
  const [duration, setDuration] = useState("");
  const [unit, setUnit] = useState("minutes");
  const [confirm, setConfirm] = useState("");

  const isSubmitting = fetcher.state === "submitting";
  const canSubmit = duration !== "" && confirm === "delete";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.deleted !== undefined) {
      onOpenChange(false);
      setDuration("");
      setConfirm("");
    }
  }, [fetcher.state, fetcher.data]);

  const handleDelete = () => {
    fetcher.submit(
      JSON.stringify({ duration, unit, confirm }),
      {
        method: "POST",
        action: "/api/v1/memory/delete-range",
        encType: "application/json",
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Data</DialogTitle>
          <DialogDescription>
            Choose a duration to remove data for. Data collected during the
            selected period will be permanently deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="font-semibold">Warning:</span> this action is not
          reversible. Please be certain.
        </div>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              Enter the duration for which you'd like to delete your data
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="Enter duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                type="number"
                min={1}
                className="flex-1"
              />
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              To verify, type <strong>'delete'</strong> below
            </label>
            <Input
              placeholder="Enter 'delete' to confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          {fetcher.data?.error && (
            <p className="text-destructive text-sm">{fetcher.data.error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? "Deleting..." : "Delete Data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MemorySettings() {
  const { isDesktop, invoke } = useTauri();
  const [settings, setSettings] = useState<ScreenContextSettings | null>(null);
  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [togglingApp, setTogglingApp] = useState<string | null>(null);

  // Load settings + running apps (names only), then lazy-load icons per app
  useEffect(() => {
    if (!isDesktop) return;

    invoke<ScreenContextSettings>("get_screen_context_settings").then(
      (s) => s && setSettings(s),
    );

    invoke<{ name: string }[]>("get_running_apps").then((apps) => {
      if (!apps) return;
      // Initialise with no icons, then fetch each icon lazily
      const initial: RunningApp[] = apps.map((a) => ({ name: a.name, icon: null }));
      setRunningApps(initial);

      initial.forEach((app) => {
        invoke<string | null>("get_app_icon", { name: app.name }).then((icon) => {
          setRunningApps((prev) =>
            prev.map((a) => (a.name === app.name ? { ...a, icon: icon ?? null } : a)),
          );
        });
      });
    });
  }, [isDesktop, invoke]);

  const handlePauseToggle = async (paused: boolean) => {
    await invoke("set_screen_context_paused", { paused });
    setSettings((prev) => prev ? { ...prev, paused } : prev);
  };

  const handleAppToggle = async (appName: string, enabled: boolean) => {
    if (!settings) return;
    setTogglingApp(appName);

    const newEnabled = enabled
      ? [...settings.enabled_apps, appName]
      : settings.enabled_apps.filter((a) => a !== appName);

    await invoke("set_enabled_apps", { enabled: newEnabled });
    setSettings((prev) => prev ? { ...prev, enabled_apps: newEnabled } : prev);
    setTogglingApp(null);
  };

  if (!isDesktop) {
    return (
      <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
        <SettingSection
          title="Memory"
          description="Screen context capture settings"
        >
          <Card>
            <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <Monitor size={18} />
              This feature is only available in the CORE desktop app.
            </CardContent>
          </Card>
        </SettingSection>
      </div>
    );
  }

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Memory"
        description="Control how CORE captures context from your screen."
      >
        <div className="flex flex-col gap-6">
          {/* Pause toggle */}
          <div>
            <h2 className="text-md mb-4">Screen context capture</h2>
            <Card>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">Capture screen context</p>
                  <p className="text-muted-foreground text-sm">
                    CORE reads the active window via Accessibility API to build
                    context. No screenshots are taken.
                  </p>
                </div>
                <Checkbox
                  checked={!settings?.paused}
                  onCheckedChange={(checked) => handlePauseToggle(!checked)}
                  disabled={settings === null}
                />
              </CardContent>
            </Card>
          </div>

          {/* Per-app toggles */}
          {runningApps.length > 0 && !settings?.paused && (
            <div>
              <h2 className="text-md mb-4">Apps</h2>
              <Card>
                <CardContent className="flex flex-col divide-y p-0">
                  {runningApps.map((app) => {
                    const enabled = settings?.enabled_apps.includes(app.name) ?? false;
                    return (
                      <div
                        key={app.name}
                        className="flex items-center justify-between px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          {app.icon ? (
                            <img
                              src={`data:image/png;base64,${app.icon}`}
                              alt={app.name}
                              className="h-6 w-6 rounded"
                            />
                          ) : (
                            <div className="bg-muted h-6 w-6 rounded" />
                          )}
                          <span className="text-sm font-medium">{app.name}</span>
                        </div>
                        <Checkbox
                          checked={enabled}
                          onCheckedChange={(v) => handleAppToggle(app.name, !!v)}
                          disabled={togglingApp === app.name || !settings}
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Delete data */}
          <div>
            <h2 className="text-md mb-4">Danger Zone</h2>
            <Card className="border-destructive/50">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Delete captured data</p>
                    <p className="text-muted-foreground text-sm">
                      Remove memory collected during a specific time period.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="lg"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <AlertTriangle size={16} className="mr-2" />
                    Delete Data
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </SettingSection>

      <DeleteDataDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  );
}
