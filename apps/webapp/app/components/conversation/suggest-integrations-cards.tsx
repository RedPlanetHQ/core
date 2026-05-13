import { useState } from "react";
import { LayoutGrid, LoaderCircle } from "lucide-react";

import { Button } from "../ui";
import { ICON_MAPPING, type IconType } from "../icon-utils";
import { type ConversationToolPart } from "./conversation-utils";

/**
 * Inline integration connect cards for the suggest_integrations tool.
 *
 * The agent picks 1-3 integrations grounded in what it actually knows
 * about the user; we render a card per pick with a Connect button that
 * hits /api/v1/oauth to get a redirect URL and navigates the user to it.
 * After OAuth completes, the user lands back on the same page they
 * started from — for onboarding that's /onboarding, for normal chat
 * it's /home/conversation/<id>.
 *
 * Conceptually the same UI shape as the old onboarding suggestions
 * page (cards with reasons + Connect actions), but inline in the chat
 * thread because suggest_integrations is now a global agent capability,
 * not an onboarding-only step.
 */

interface SuggestIntegrationsCard {
  slug: string;
  name: string;
  icon: string | null;
  definitionId: string;
  reason: string;
}

interface SuggestIntegrationsPayload {
  message: string | null;
  cards: SuggestIntegrationsCard[];
  unknown: string[];
}

interface SuggestIntegrationsCardsProps {
  part: ConversationToolPart;
}

function parseToolOutput(
  output: unknown,
): SuggestIntegrationsPayload | null {
  if (!output) return null;
  // Mastra wraps text results as { content: [{ type: "text", text }] }
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

export function SuggestIntegrationsCards({
  part,
}: SuggestIntegrationsCardsProps) {
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRunning =
    part.state !== "output-available" &&
    part.state !== "output-error" &&
    part.state !== "output-denied";

  if (isRunning) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-1 text-sm">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        <span>picking integrations…</span>
      </div>
    );
  }

  const payload = parseToolOutput(part.output);
  if (!payload || payload.cards.length === 0) return null;

  const handleConnect = async (card: SuggestIntegrationsCard) => {
    setError(null);
    setConnectingSlug(card.slug);
    try {
      const res = await fetch("/api/v1/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrationDefinitionId: card.definitionId,
          redirectURL: window.location.href,
        }),
      });
      if (!res.ok) {
        throw new Error(`oauth start failed: ${res.status}`);
      }
      const data = (await res.json()) as { redirectURL?: string };
      if (!data.redirectURL) {
        throw new Error("oauth response missing redirectURL");
      }
      window.location.href = data.redirectURL;
    } catch (e) {
      setConnectingSlug(null);
      setError(e instanceof Error ? e.message : "could not start oauth");
    }
  };

  return (
    <div className="flex flex-col gap-2 py-2">
      {payload.message && (
        <p className="text-muted-foreground text-sm">{payload.message}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {payload.cards.map((card) => {
          const IconComponent =
            ICON_MAPPING[card.slug as IconType] ??
            ICON_MAPPING[card.icon as IconType];
          const isConnecting = connectingSlug === card.slug;
          return (
            <div
              key={card.slug}
              className="border-border bg-background flex w-full max-w-md flex-col gap-2 rounded-md border p-3"
            >
              <div className="flex items-center gap-2">
                {IconComponent ? (
                  <IconComponent size={18} />
                ) : (
                  <LayoutGrid size={18} />
                )}
                <span className="font-medium">{card.name}</span>
              </div>
              <p className="text-muted-foreground text-sm">{card.reason}</p>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleConnect(card)}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <span className="flex items-center gap-1.5">
                      <LoaderCircle className="h-3 w-3 animate-spin" />
                      connecting…
                    </span>
                  ) : (
                    `Connect ${card.name}`
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
