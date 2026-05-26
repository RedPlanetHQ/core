import {useState} from 'react';
import {Loader2} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {Button} from '~/components/ui/button';
import {cn} from '~/lib/utils';

export interface GatewayChoice {
  id: string;
  name: string;
  status: 'CONNECTED' | 'DISCONNECTED';
  lastSeenAt: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateways: GatewayChoice[];
  /** Resolves when install succeeds; rejects with an Error on failure. */
  onInstall: (gatewayId: string) => Promise<void>;
  skillTitle: string;
}

export function SelectGatewayDialog({
  open,
  onOpenChange,
  gateways,
  onInstall,
  skillTitle,
}: Props) {
  const [selected, setSelected] = useState<string | null>(
    gateways.find((g) => g.status === 'CONNECTED')?.id ?? null,
  );
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!selected) return;
    setInstalling(true);
    setError(null);
    try {
      await onInstall(selected);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'install failed');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install &quot;{skillTitle}&quot;</DialogTitle>
          <DialogDescription>
            Choose which gateway should install this skill.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          {gateways.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No gateways connected to this workspace yet.
            </p>
          ) : (
            gateways.map((g) => {
              const offline = g.status !== 'CONNECTED';
              return (
                <button
                  key={g.id}
                  type="button"
                  disabled={offline}
                  onClick={() => setSelected(g.id)}
                  className={cn(
                    'flex items-center gap-3 rounded border px-3 py-2 text-left',
                    selected === g.id && !offline
                      ? 'border-primary bg-primary/10'
                      : 'bg-background-3 hover:bg-background-2',
                    offline && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <div className="flex flex-1 flex-col">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {offline
                        ? `offline${g.lastSeenAt ? ` · last seen ${new Date(g.lastSeenAt).toLocaleString()}` : ''}`
                        : 'connected'}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={installing}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selected || installing}
            className="gap-1.5"
          >
            {installing ? <Loader2 size={12} className="animate-spin" /> : null}
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
