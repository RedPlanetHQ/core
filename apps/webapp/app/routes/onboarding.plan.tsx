import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { useTypedLoaderData } from "remix-typedjson";
import { Prisma } from "@prisma/client";
import type { LoaderData } from "~/utils/loader-data";
import { requireUser } from "~/services/session.server";
import { prisma } from "~/db.server";
import { Button } from "~/components/ui/button";
import { isBillingEnabled } from "~/config/billing.server";
import { createCheckoutSession } from "~/services/stripe.server";
import { ArrowRight, ExternalLink } from "lucide-react";

type UserMetadata = Record<string, unknown>;

const PLAN_STEP_KEY = "planStepComplete";

async function markPlanStepComplete(
  userId: string,
  metadata: UserMetadata,
  { zeroCredits }: { zeroCredits: boolean },
) {
  const next: UserMetadata = { ...metadata, [PLAN_STEP_KEY]: true };
  await prisma.user.update({
    where: { id: userId },
    data: { metadata: next as Prisma.InputJsonValue },
  });

  if (zeroCredits) {
    // Zero the free-tier credits granted at signup. From here, the user
    // needs a paid plan (Stripe webhook tops up on upgrade) or BYOK
    // (bypasses the credit check entirely) to keep using the agent.
    await prisma.userUsage.updateMany({
      where: { userId },
      data: { availableCredits: 0 },
    });
  }
}

async function getWorkspacePlan(workspaceId: string | null) {
  if (!workspaceId) return "FREE" as const;
  const sub = await prisma.subscription.findUnique({
    where: { workspaceId },
    select: { planType: true },
  });
  return (sub?.planType ?? "FREE") as "FREE" | "PRO" | "MAX";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  if (!user.onboardingComplete) {
    return redirect("/onboarding");
  }

  const metadata = (user.metadata ?? {}) as UserMetadata;
  if (metadata[PLAN_STEP_KEY]) {
    return redirect("/home/daily");
  }

  // Self-hosted / billing disabled → nothing to sell. Mark complete and go.
  if (!isBillingEnabled()) {
    await markPlanStepComplete(user.id, metadata, { zeroCredits: false });
    return redirect("/home/daily");
  }

  // Already on a paid plan (rare — e.g. team-provisioned workspace).
  // Nothing to upsell; preserve their credits and move on.
  const plan = await getWorkspacePlan(user.workspaceId ?? null);
  if (plan !== "FREE") {
    await markPlanStepComplete(user.id, metadata, { zeroCredits: false });
    return redirect("/home/daily");
  }

  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const metadata = (user.metadata ?? {}) as UserMetadata;

  if (intent === "subscribe") {
    if (!user.workspaceId) {
      return json({ error: "Workspace not found" }, { status: 400 });
    }
    const planType = (formData.get("planType") as "PRO" | "MAX") || "PRO";
    const origin = new URL(request.url).origin;

    // Mark up front so an abandoned checkout still lets them reach /home
    // (they'll see the upgrade modal there until they actually pay). Zero
    // the free credits — the Stripe webhook refills them on successful
    // subscription creation.
    await markPlanStepComplete(user.id, metadata, { zeroCredits: true });

    const checkoutUrl = await createCheckoutSession({
      workspaceId: user.workspaceId,
      planType,
      email: user.email,
      successUrl: `${origin}/home/daily?checkout=success`,
      cancelUrl: `${origin}/home/daily?checkout=canceled`,
    });

    return json({ checkoutUrl });
  }

  if (intent === "byok") {
    // Same treatment as subscribe — they've made a choice, credits go to
    // zero. BYOK bypasses the credit check, so once they add a key in
    // settings they can use the agent freely.
    await markPlanStepComplete(user.id, metadata, { zeroCredits: true });
    return redirect("/settings/workspace/models?onboarding=1");
  }

  return json({ error: "Invalid intent" }, { status: 400 });
}

export default function OnboardingPlan() {
  useTypedLoaderData<typeof loader>() as LoaderData<typeof loader>;
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  if (
    fetcher.data &&
    "checkoutUrl" in fetcher.data &&
    fetcher.data.checkoutUrl
  ) {
    window.location.href = fetcher.data.checkoutUrl as string;
  }

  const submit = (intent: string, extra: Record<string, string> = {}) => {
    fetcher.submit({ intent, ...extra }, { method: "POST" });
  };

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-5xl flex-col gap-10">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">

          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            power me up.
          </h1>
          <p className="text-muted-foreground text-base md:text-lg">
            i run on an LLM. pick a CORE plan, or bring your own key from a
            provider you already pay for.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* CORE subscription — recommended */}
          <div className="bg-background-2 relative flex flex-col gap-6 overflow-hidden rounded-xl border-2 p-6">


            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold">CORE subscription</h2>
              <p className="text-muted-foreground text-sm">
                managed cloud — models, gateway, credits, everything.
              </p>
            </div>

            <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
              <li className="flex items-baseline gap-2">
                <span className="text-foreground w-8 font-medium">Pro</span>
                <span>10k credits/mo · $19</span>
              </li>
              <li className="flex items-baseline gap-2">
                <span className="text-foreground w-8 font-medium">Max</span>
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
                onClick={() => submit("subscribe", { planType: "PRO" })}
                disabled={busy}
                className="justify-between"
              >
                <span>Subscribe to Pro · $19/mo</span>
                <ArrowRight className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => submit("subscribe", { planType: "MAX" })}
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
                point me at a provider you already pay for. you handle the
                bill, i skip CORE credits entirely.
              </p>
            </div>

            <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
              <li>• OpenAI, Anthropic, OpenRouter, Ollama, Azure, and more.</li>
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
                onClick={() => submit("byok")}
                disabled={busy}
                className="w-full justify-between"
              >
                <span>Set up my own key</span>
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        <p className="text-muted-foreground text-center text-xs">
          you have 500 free credits — enough to try me a few times. after that
          i'll need a plan or your own key.
        </p>
      </div>
    </div>
  );
}
