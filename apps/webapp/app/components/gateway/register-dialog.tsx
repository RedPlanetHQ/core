import { useState } from "react";
import { ArrowLeft, Container, Plus, Rocket, Terminal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

type DeployKind = "native" | "docker" | "railway";

interface Props {
  /** Optional custom trigger; defaults to a "+ New gateway" button. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  onRegistered?: () => void;
}

const KIND_OPTIONS: Array<{
  kind: DeployKind;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    kind: "native",
    title: "Native",
    description: "Run on this machine via the CLI (full local access).",
    icon: Terminal,
  },
  {
    kind: "docker",
    title: "Docker",
    description: "Run in a container locally or on a remote Docker host.",
    icon: Container,
  },
  {
    kind: "railway",
    title: "Railway",
    description: "One-click deploy to Railway with a managed public URL.",
    icon: Rocket,
  },
];

/**
 * Self-contained Register Gateway dialog. Mirrors the flow that used to live
 * inline in `settings.workspace.gateway.tsx` so the sidebar's `+` button and
 * any future entry points can reuse it.
 */
export function RegisterGatewayDialog({
  trigger,
  open,
  onOpenChange,
  onRegistered,
}: Props) {
  const isControlled = typeof open === "boolean";
  const [internalOpen, setInternalOpen] = useState(false);
  const actualOpen = isControlled ? (open as boolean) : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };

  const [kind, setKind] = useState<DeployKind | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [securityKey, setSecurityKey] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setKind(null);
    setBaseUrl("");
    setSecurityKey("");
    setStatus("idle");
    setError(null);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/v1/gateways", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: "register",
          baseUrl,
          securityKey,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Request failed (${res.status})`);
        setStatus("error");
        return;
      }
      reset();
      setOpen(false);
      onRegistered?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <Dialog
      open={actualOpen}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      {trigger === null ? null : trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button variant="secondary" className="gap-2">
            <Plus size={14} />
            New gateway
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="flex w-full max-w-sm flex-col">
        <DialogHeader>
          <DialogTitle>
            {kind ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setKind(null);
                    setError(null);
                  }}
                  className="text-muted-foreground hover:text-foreground -ml-1 rounded p-1"
                  aria-label="Back to deploy options"
                >
                  <ArrowLeft size={16} />
                </button>
                Register gateway ·{" "}
                {kind === "native"
                  ? "Native"
                  : kind === "docker"
                    ? "Docker"
                    : "Railway"}
              </span>
            ) : (
              "Register a gateway"
            )}
          </DialogTitle>
        </DialogHeader>

        {!kind ? (
          <>
            <p className="text-muted-foreground text-sm">
              Pick where this gateway should run. We'll show the exact steps,
              then you paste the URL and security key it prints.
            </p>
            <div className="flex flex-col gap-2 py-2">
              {KIND_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.kind}
                    type="button"
                    onClick={() => setKind(opt.kind)}
                    className="hover:bg-muted/60 flex items-start gap-3 rounded-md border p-3 text-left transition-colors"
                  >
                    <Icon size={18} className="mt-0.5 shrink-0" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{opt.title}</span>
                      <span className="text-muted-foreground text-xs">
                        {opt.description}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <DialogFooter className="border-none py-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DeploySteps kind={kind} />
            <form
              onSubmit={handleSubmit}
              id="register-gateway-form"
              className="flex flex-col gap-3 py-2"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Base URL</label>
                <Input
                  placeholder={
                    kind === "native"
                      ? "https://<device>.<tailnet>.ts.net"
                      : "https://your-gateway.example.com"
                  }
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  type="url"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Security key</label>
                <Textarea
                  placeholder="gwk_..."
                  value={securityKey}
                  onChange={(e) => setSecurityKey(e.target.value)}
                  rows={2}
                  required
                  className="font-mono text-xs"
                />
              </div>
              {error ? (
                <p className="text-destructive text-sm">{error}</p>
              ) : null}
            </form>
            <DialogFooter className="border-none py-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="secondary"
                form="register-gateway-form"
                disabled={status === "submitting" || !baseUrl || !securityKey}
              >
                {status === "submitting" ? "Registering..." : "Register"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeploySteps({ kind }: { kind: DeployKind }) {
  if (kind === "native") {
    return (
      <div className="flex min-w-0 flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          The native gateway binds to <code>127.0.0.1</code>, so CORE reaches it
          through a tunnel. Install <strong>Tailscale</strong> or{" "}
          <strong>ngrok</strong> first — the setup wizard will pick one.
        </p>
        <CodeBlock>
          {`# Install a tunnel (macOS shown — see their docs for Linux)
brew install --cask tailscale
brew install ngrok

# Install the CLI and run setup
npm install -g @redplanethq/corebrain
corebrain login
corebrain gateway setup --kind native`}
        </CodeBlock>
        <p className="text-muted-foreground text-xs">
          The wizard installs a launchd / systemd service, starts the tunnel,
          and prints the public <code>baseUrl</code> + <code>securityKey</code>.
          Paste them below. Rotate later with{" "}
          <code>corebrain gateway register</code>.
        </p>
      </div>
    );
  }

  if (kind === "docker") {
    return (
      <div className="flex min-w-0 flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Drop the official compose file into a directory, fill in env vars, and
          bring it up. The first boot prints a security key in the logs.
        </p>
        <CodeBlock>
          {`# 1. Grab the compose file
curl -O https://raw.githubusercontent.com/RedPlanetHQ/core/main/hosting/gateway/docker-compose.yaml

# 2. Set env vars (or write a .env next to it)
export COREBRAIN_API_URL=https://app.getcore.me
export COREBRAIN_API_KEY=<personal access token>
export COREBRAIN_GATEWAY_NAME=cloud-gateway

# 3. Boot it
docker compose up -d

# 4. Read the security key from the logs
docker compose logs corebrain-gateway | grep -i "security key"`}
        </CodeBlock>
        <p className="text-muted-foreground text-xs">
          For a remote Docker host, expose port <code>7787</code> over HTTPS
          (Tailscale Funnel, Caddy, ngrok, …) and use that public URL below.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Click Deploy on Railway, set the env vars Railway prompts for, then copy
        the public domain it provisions and the security key from the first
        deploy log.
      </p>
      <a
        href="https://railway.com/deploy/core-gateway"
        target="_blank"
        rel="noreferrer"
        className="self-start"
      >
        <img
          src="https://railway.com/button.svg"
          alt="Deploy on Railway"
          className="h-9"
        />
      </a>
      <div className="text-muted-foreground text-xs">
        Required env vars:
        <ul className="mt-1 list-disc pl-5">
          <li>
            <code>COREBRAIN_API_URL</code> — your CORE instance URL
          </li>
          <li>
            <code>COREBRAIN_API_KEY</code> — Personal Access Token from the
            webapp
          </li>
          <li>
            <code>COREBRAIN_GATEWAY_NAME</code> — name shown in the webapp
          </li>
          <li>
            <code>COREBRAIN_GATEWAY_SECURITY_KEY</code> — leave empty to
            auto-generate (find it in the deploy logs)
          </li>
        </ul>
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-grayAlpha-100 overflow-x-auto rounded-md border p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  );
}
