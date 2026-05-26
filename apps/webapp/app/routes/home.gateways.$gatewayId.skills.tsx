import {useState} from 'react';
import {Library, Loader2, Plus, Trash2} from 'lucide-react';
import {Button} from '~/components/ui/button';
import {Input} from '~/components/ui/input';
import {useGateway} from '~/components/gateway/gateway-provider';

interface InstallResponse {
  skill?: unknown;
  error?: string;
}

interface DeleteResponse {
  ok?: boolean;
  error?: string;
}

export default function GatewaySkillsTab() {
  const gw = useGateway();
  const [url, setUrl] = useState('');
  const [skill, setSkill] = useState('');
  const [force, setForce] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [removingName, setRemovingName] = useState<string | null>(null);

  const handleInstall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const res = await fetch(`/api/v1/gateways/${gw.id}/skills`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          source: 'url',
          url: url.trim(),
          skill: skill.trim() || undefined,
          force,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as InstallResponse;
      if (!res.ok) {
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      setUrl('');
      setSkill('');
      setForce(false);
      gw.refresh();
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setInstalling(false);
    }
  };

  const handleRemove = async (name: string) => {
    setRemovingName(name);
    try {
      const res = await fetch(
        `/api/v1/gateways/${gw.id}/skills/${encodeURIComponent(name)}`,
        {method: 'DELETE'},
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as DeleteResponse;
        // eslint-disable-next-line no-alert
        alert(body.error ?? `Failed (${res.status})`);
      }
      gw.refresh();
    } finally {
      setRemovingName(null);
    }
  };

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-6 px-4 py-6">
      {/* Install panel */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Install a skill</h2>
        <form onSubmit={handleInstall} className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
            <Input
              placeholder="https://github.com/owner/repo"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={installing}
              required
            />
            <Input
              placeholder="skill (optional)"
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              disabled={installing}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                disabled={installing}
              />
              Overwrite if already installed
            </label>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              disabled={installing}
            >
              {installing ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Install
            </Button>
          </div>
        </form>
        {installError ? (
          <p className="text-destructive text-sm">{installError}</p>
        ) : null}
        <p className="text-muted-foreground text-sm">
          Or browse the library:{' '}
          <a className="underline" href="/home/agent/skills?target=gateway">
            gateway skills →
          </a>
        </p>
      </section>

      {/* Installed table */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">
          Installed skills ({gw.skills.length})
        </h2>
        {gw.skills.length === 0 ? (
          <div className="bg-background-3 flex flex-col items-center gap-2 rounded border px-4 py-8 text-center">
            <Library className="text-muted-foreground" size={24} />
            <p className="text-muted-foreground text-sm">
              No skills installed yet. Use the form above or the library.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {gw.skills.map((s) => (
              <div
                key={s.name}
                className="bg-background-3 flex items-start gap-3 rounded border px-3 py-2"
              >
                <Library size={16} className="text-muted-foreground mt-1 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted-foreground text-sm">
                    {s.description}
                  </span>
                  {s.allowedTools?.length ? (
                    <span className="text-muted-foreground mt-1 font-mono text-xs">
                      allowed-tools: {s.allowedTools.join(', ')}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground truncate font-mono text-xs">
                    {s.path}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-7 w-7"
                  disabled={removingName === s.name}
                  onClick={() => handleRemove(s.name)}
                  title="Remove skill"
                >
                  {removingName === s.name ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
