import { useFetcher } from "@remix-run/react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

/**
 * Blocks the /home surface for FREE users who haven't yet paid or set up
 * BYOK. Non-dismissible — the app is unusable until they pick a path.
 *
 * Mirrors the visual language of the /onboarding/plan page so the two
 * feel like one flow. Subscribe posts to /onboarding/plan (which returns
 * a Stripe checkout URL and no-ops the already-set planStepComplete
 * flag). BYOK is a plain link to the workspace models settings page.
 */
export function UpgradeRequiredModal() {
  const fetcher = useFetcher<{ checkoutUrl?: string; error?: string }>();
  const busy = fetcher.state !== "idle";

  if (fetcher.data?.checkoutUrl) {
    window.location.href = fetcher.data.checkoutUrl;
  }

  const subscribe = (planType: "PRO" | "MAX") => {
    fetcher.submit(
      { intent: "subscribe", planType },
      { method: "POST", action: "/onboarding/plan" },
    );
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="max-w-4xl border-none bg-transparent p-0 shadow-none sm:max-w-4xl"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="rounded-2xl px-8 py-10 border-none">
          <div className="flex flex-col gap-10">
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">

              <h1 className="text-3xl font-semibold tracking-tight md:text-3xl">
                power me up.
              </h1>
              <p className="text-muted-foreground text-base md:text-md">
                to keep using the agent, subscribe to a CORE plan or bring
                your own key from a provider you already pay for.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* CORE subscription — recommended */}
              <div className="border-primary/40 bg-background-2 relative flex flex-col gap-6 overflow-hidden rounded-xl border-2 p-6">


                <div className="flex flex-col gap-1">
                  <h2 className="text-xl font-semibold">CORE subscription</h2>
                  <p className="text-muted-foreground text-sm">
                    managed cloud — models, gateway, credits, everything.
                  </p>
                </div>

                <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
                  <li className="flex items-baseline gap-2">
                    <span className="text-foreground w-8 font-medium">
                      Pro
                    </span>
                    <span>10k credits/mo · $19</span>
                  </li>
                  <li className="flex items-baseline gap-2">
                    <span className="text-foreground w-8 font-medium">
                      Max
                    </span>
                    <span>100k credits/mo · $99</span>
                  </li>
                  <li className="flex items-baseline gap-2">
                    <span className="text-foreground w-8" />
                    <span>top up any time, credits never expire.</span>
                  </li>
                </ul>

                <div className="mt-auto flex flex-col gap-2">
                  <Button
                    size="lg"
                    onClick={() => subscribe("PRO")}
                    disabled={busy}
                    className="justify-between"
                  >
                    <span>Subscribe to Pro · $19/mo</span>
                    <ArrowRight className="size-4" />
                  </Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    onClick={() => subscribe("MAX")}
                    disabled={busy}
                    className="justify-between"
                  >
                    <span>Subscribe to Max · $99/mo</span>
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>

              {/* BYOK */}
              <div className="border-border bg-background-2 flex flex-col gap-6 rounded-xl border p-6">
                <div className="flex flex-col gap-1">
                  <h2 className="text-xl font-semibold">Bring your own key</h2>
                  <p className="text-muted-foreground text-sm">
                    point me at a provider you already pay for. you handle
                    the bill, i skip CORE credits entirely.
                  </p>
                </div>

                <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
                  <li>
                    • OpenAI, Anthropic, OpenRouter, Ollama, Azure, and more.
                  </li>
                  <li>
                    • already on Claude Max or ChatGPT with Codex?{" "}
                    <a
                      href="https://docs.getcore.me/gateway/subscription-proxy"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary inline-flex items-center gap-1 underline underline-offset-2"
                    >
                      reuse your subscription
                      <ExternalLink className="size-3" />
                    </a>{" "}
                    — no separate API key.
                  </li>
                  <li>• unlimited use — no CORE credits touched.</li>
                </ul>

                <div className="mt-auto">
                  <Button
                    size="lg"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      window.location.href = "/settings/workspace/models";
                    }}
                    className="w-full justify-between"
                  >
                    <span>Set up my own key</span>
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
