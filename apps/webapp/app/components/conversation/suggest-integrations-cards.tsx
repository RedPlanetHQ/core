import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, LoaderCircle, Check } from "lucide-react";
import { useFetcher, useRevalidator } from "@remix-run/react";

import { Button } from "../ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ICON_MAPPING, type IconType } from "../icon-utils";
import { type ConversationToolPart } from "./conversation-utils";
import { useChatContext } from "./chat-context";
import { ApiKeyAuthSection } from "../integrations/api-key-auth-section";
import { OAuthAuthSection } from "../integrations/oauth-auth-section";
import { McpOAuthAuthSection } from "../integrations/mcp-oauth-auth-section";
import { MCPAuthSection } from "../integrations/mcp-auth-section";

/**
 * Inline integration connect "card" for the suggest_integrations tool.
 *
 * Renders a single container with one row per suggested integration.
 * Each row has its own Connect button that opens a modal with the
 * appropriate auth UI (OAuth, API key, MCP). A background poll watches
 * /api/v1/integration_account for connections landing, marks rows as
 * Connected as they come in. At the bottom: a single "Continue
 * conversation" / "Skip for now" CTA that injects a user message into
 * the chat naming whichever integrations the user connected — so the
 * agent picks it up and does the follow-up analysis.
 */

interface SuggestIntegrationsCard {
  slug: string;
  name: string;
  icon: string | null;
  definitionId: string;
  reason: string;
  /** Raw spec from the integration definition row — used by the modal
   *  to decide which auth UI to render. */
  spec: unknown;
}

interface SuggestIntegrationsPayload {
  message: string | null;
  cards: SuggestIntegrationsCard[];
  unknown: string[];
}

interface SuggestIntegrationsCardsProps {
  part: ConversationToolPart;
}

function parseToolOutput(output: unknown): SuggestIntegrationsPayload | null {
  if (!output) return null;
  const rawText: string | null = (() => {
    if (typeof output === "string") return output;
    if (typeof output === "object" && output && "content" in output) {
      const content = (output as { content?: unknown }).content;
      if (Array.isArray(content) && content[0]) {
        const first = content[0] as { text?: unknown };
        return typeof first.text === "string" ? first.text : null;
      }
    }
    return null;
  })();
  if (rawText === null) return null;
  try {
    const parsed = JSON.parse(rawText) as SuggestIntegrationsPayload;
    if (!parsed || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseSpec(spec: unknown): any {
  if (!spec) return {};
  if (typeof spec === "string") {
    try {
      return JSON.parse(spec);
    } catch {
      return {};
    }
  }
  return spec;
}

const POLL_INTERVAL_MS = 5000;

interface IntegrationAccountsPayload {
  accounts: Array<{
    integrationDefinition: { slug: string };
  }>;
}

export function SuggestIntegrationsCards({
  part,
}: SuggestIntegrationsCardsProps) {
  const chat = useChatContext();
  const [openCard, setOpenCard] = useState<SuggestIntegrationsCard | null>(
    null,
  );
  const [connectedSlugs, setConnectedSlugs] = useState<Set<string>>(new Set());
  const [hasContinued, setHasContinued] = useState(false);
  const accountsFetcher = useFetcher<IntegrationAccountsPayload>();

  const isRunning =
    part.state !== "output-available" &&
    part.state !== "output-error" &&
    part.state !== "output-denied";

  const payload = useMemo(
    () => (isRunning ? null : parseToolOutput(part.output)),
    [isRunning, part.output],
  );

  // Seed connected state from the first fetcher response so a returning
  // user (e.g. after an OAuth roundtrip) sees the right rows already
  // marked Connected on first render.
  useEffect(() => {
    if (!accountsFetcher.data?.accounts) return;
    const incoming = new Set(
      accountsFetcher.data.accounts.map((a) => a.integrationDefinition.slug),
    );
    setConnectedSlugs((prev) => {
      const merged = new Set(prev);
      for (const slug of incoming) merged.add(slug);
      return merged;
    });
  }, [accountsFetcher.data]);

  // Poll while there are still pending (suggested-but-not-connected) slugs.
  const pendingSlugs = useMemo(() => {
    if (!payload) return [] as string[];
    return payload.cards
      .map((c) => c.slug)
      .filter((slug) => !connectedSlugs.has(slug));
  }, [payload, connectedSlugs]);

  const hasPolledOnceRef = useRef(false);
  useEffect(() => {
    if (!payload || hasContinued) return;
    // Always do one initial load so we hydrate connected state on mount.
    if (!hasPolledOnceRef.current) {
      hasPolledOnceRef.current = true;
      accountsFetcher.load("/api/v1/integration_account");
    }
    if (pendingSlugs.length === 0) return;
    const id = window.setInterval(() => {
      accountsFetcher.load("/api/v1/integration_account");
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, pendingSlugs.length, hasContinued]);

  if (isRunning) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-1 text-sm">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        <span>picking integrations…</span>
      </div>
    );
  }

  if (!payload || payload.cards.length === 0) return null;

  const connectedFromSuggestions = payload.cards.filter((c) =>
    connectedSlugs.has(c.slug),
  );
  const anyConnected = connectedFromSuggestions.length > 0;

  const handleContinue = () => {
    if (hasContinued) return;
    setHasContinued(true);
    if (!chat) return;
    if (anyConnected) {
      const names = connectedFromSuggestions.map((c) => c.name).join(", ");
      chat.sendMessage(
        `i just connected ${names} — take a look at what's there and tell me a few specific things.`,
      );
    } else {
      chat.sendMessage("i'll skip the integrations for now — let's continue.");
    }
  };

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3 py-2">
      {payload.message && <p>{payload.message}</p>}

      <div className="border-border bg-background flex flex-col divide-y rounded-md border">
        {payload.cards.map((card) => {
          const IconComponent =
            ICON_MAPPING[card.slug as IconType] ??
            ICON_MAPPING[card.icon as IconType];
          const isConnected = connectedSlugs.has(card.slug);
          return (
            <div key={card.slug} className="flex items-start gap-3 p-3">
              <div className="bg-background-2 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded">
                {IconComponent ? (
                  <IconComponent size={18} />
                ) : (
                  <LayoutGrid size={18} />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <span className="font-medium">{card.name}</span>
                <p className="text-muted-foreground text-sm">{card.reason}</p>
              </div>
              <div className="shrink-0">
                {isConnected ? (
                  <span className="text-success bg-success/10 inline-flex items-center gap-1 rounded px-2 py-1 text-sm">
                    <Check size={14} />
                    Connected
                  </span>
                ) : (
                  <Button variant="secondary" onClick={() => setOpenCard(card)}>
                    Connect
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!hasContinued && (
        <div className="flex justify-end">
          <Button
            variant={anyConnected ? "default" : "ghost"}
            onClick={handleContinue}
          >
            {anyConnected ? "Continue conversation" : "Skip for now"}
          </Button>
        </div>
      )}
      {hasContinued && (
        <p className="text-muted-foreground text-sm italic">
          {anyConnected
            ? `continuing with ${connectedFromSuggestions.map((c) => c.name).join(", ")}…`
            : "continuing…"}
        </p>
      )}

      <ConnectIntegrationModal
        card={openCard}
        onClose={() => setOpenCard(null)}
      />
    </div>
  );
}

interface IntegrationDefinitionPayload {
  integration: {
    id: string;
    slug: string;
    name: string;
    icon: string;
    description: string;
    spec: unknown;
  };
  activeAccounts: Array<{ id: string }>;
}

function ConnectIntegrationModal({
  card,
  onClose,
}: {
  card: SuggestIntegrationsCard | null;
  onClose: () => void;
}) {
  // Fetch the fresh integration definition + spec from the API when the
  // modal opens. We don't trust card.spec because cached tool calls
  // from before this field was added won't have it, and specs can
  // change over time anyway.
  const definitionFetcher = useFetcher<IntegrationDefinitionPayload>();
  const installFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    if (!card) return;
    definitionFetcher.load(
      `/api/v1/integration_definition/${encodeURIComponent(card.slug)}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.slug]);

  const specData = useMemo(
    () => parseSpec(definitionFetcher.data?.integration?.spec ?? card?.spec),
    [definitionFetcher.data, card],
  );

  const handleWidgetInstall = useCallback(() => {
    if (!card) return;
    setInstallError(null);
    installFetcher.submit(
      { integrationDefinitionId: card.definitionId },
      {
        method: "post",
        action: "/api/v1/integration_account",
        encType: "application/json",
      },
    );
  }, [card, installFetcher]);

  useEffect(() => {
    if (installFetcher.state !== "idle" || !installFetcher.data) return;
    if (installFetcher.data.success) {
      revalidator.revalidate();
      onClose();
    } else if (installFetcher.data.error) {
      setInstallError(installFetcher.data.error);
    }
  }, [installFetcher.state, installFetcher.data, revalidator, onClose]);

  if (!card) return null;

  const isLoadingDefinition =
    definitionFetcher.state !== "idle" || !definitionFetcher.data;

  const integration = {
    id: card.definitionId,
    name: card.name,
    slug: card.slug,
  };

  // Same auth-detection branching as /home/integration/$slug.
  const hasApiKey = !!specData?.auth?.api_key;
  const hasOAuth2 = !!specData?.auth?.OAuth2;
  const hasMcpOAuth = !!specData?.auth?.mcp;
  const hasMCPAuth = !!(
    specData?.mcp?.type === "http" && specData?.mcp?.needsAuth
  );
  const hasWidgets =
    Array.isArray(specData?.widgets) && specData.widgets.length > 0;
  const isWidgetOnly =
    !hasApiKey && !hasOAuth2 && !hasMcpOAuth && !hasMCPAuth && hasWidgets;
  const hasAnyAuth =
    hasApiKey || hasOAuth2 || hasMcpOAuth || hasMCPAuth || isWidgetOnly;

  return (
    <Dialog open={!!card} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect {card.name}</DialogTitle>
          <DialogDescription>
            Choose how you want to connect {card.name} to CORE.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {isLoadingDefinition ? (
            <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>loading connect options…</span>
            </div>
          ) : (
            <>
              {hasOAuth2 && (
                <OAuthAuthSection
                  integration={integration}
                  specData={specData}
                  activeAccount={null}
                />
              )}
              {hasApiKey && (
                <ApiKeyAuthSection
                  integration={integration}
                  specData={specData}
                  activeAccount={null}
                />
              )}
              {hasMcpOAuth && (
                <McpOAuthAuthSection
                  integration={integration}
                  activeAccount={null}
                />
              )}
              {hasMCPAuth && (
                <MCPAuthSection
                  integration={integration}
                  activeAccount={undefined}
                  hasMCPAuth={hasMCPAuth}
                />
              )}
              {isWidgetOnly && (
                <div className="bg-background-3 rounded-lg p-4">
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    disabled={installFetcher.state === "submitting"}
                    onClick={handleWidgetInstall}
                    className="w-full"
                  >
                    {installFetcher.state === "submitting"
                      ? "Connecting..."
                      : `Connect to ${card.name}`}
                  </Button>
                  {installError && (
                    <p className="text-destructive mt-2 text-sm">
                      {installError}
                    </p>
                  )}
                </div>
              )}
              {!hasAnyAuth && (
                <p className="text-muted-foreground text-sm">
                  No supported auth method on this integration. Try connecting
                  it from the Integrations page instead.
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
