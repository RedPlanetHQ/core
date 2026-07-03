import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireUser } from "~/services/session.server";
import { getUsageSummary } from "~/services/billing.server";
import {
  createCheckoutSession,
  createBillingPortalSession,
  createTopupCheckoutSession,
  downgradeSubscription,
} from "~/services/stripe.server";
import {
  CreditCard,
  TrendingUp,
  Calendar,
  AlertCircle,
  Plus,
  Wallet,
} from "lucide-react";
import {
  BILLING_CONFIG,
  isBillingEnabled,
  validateTopupAmount,
} from "~/config/billing.server";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { prisma } from "~/db.server";
import { SettingSection } from "~/components/setting-section";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);


  // Get usage summary
  const usageSummary = await getUsageSummary(user.workspaceId as string, user.id);

  // Get billing history (only paid invoices — $0 rows are noise for FREE plan)
  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId: user.workspaceId },
    include: {
      BillingHistory: {
        where: { totalAmount: { gt: 0 } },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  // Recent top-ups for this workspace (all statuses, most recent first)
  const topups = user.workspaceId
    ? await prisma.creditTopup.findMany({
        where: { workspaceId: user.workspaceId },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    : [];

  const billingEnabled = isBillingEnabled();

  return json({
    user,
    workspace: user.workspaceId,
    usageSummary: usageSummary as any,
    billingHistory: subscription?.BillingHistory || [],
    topups,
    topupConfig: {
      minUsd: BILLING_CONFIG.topup.minUsd,
      incrementUsd: BILLING_CONFIG.topup.incrementUsd,
      creditsPerDollar: BILLING_CONFIG.topup.creditsPerDollar,
    },
    billingEnabled,
    subscription: subscription
      ? {
        status: subscription.status,
        planType: subscription.planType,
        currentPeriodEnd: subscription.currentPeriodEnd,
      }
      : null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upgrade") {
    const planType = formData.get("planType") as "PRO" | "MAX";
    const origin = new URL(request.url).origin;

    const checkoutUrl = await createCheckoutSession({
      workspaceId: user.workspaceId as string,
      planType,
      email: user.email,
      successUrl: `${origin}/settings/billing?success=true`,
      cancelUrl: `${origin}/settings/billing?canceled=true`,
    });

    return json({ checkoutUrl });
  }

  if (intent === "manage") {
    const origin = new URL(request.url).origin;

    const portalUrl = await createBillingPortalSession({
      workspaceId: user.workspaceId as string,
      returnUrl: `${origin}/settings/billing`,
    });

    return json({ portalUrl });
  }

  if (intent === "downgrade") {
    const targetPlan = formData.get("planType") as "FREE" | "PRO";

    // Downgrade subscription - keeps credits until period end, then switches to new plan
    await downgradeSubscription({
      workspaceId: user.workspaceId as string,
      newPlanType: targetPlan,
    });

    return json({
      success: true,
      message: `Successfully scheduled downgrade to ${targetPlan}. Your current credits will remain available until the end of your billing period.`,
    });
  }

  if (intent === "topup") {
    const amountUsd = Number(formData.get("amountUsd"));
    const validated = validateTopupAmount(amountUsd);
    if (!validated.ok) {
      return json({ error: validated.error }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const checkoutUrl = await createTopupCheckoutSession({
      workspaceId: user.workspaceId as string,
      userId: user.id,
      email: user.email,
      amountUsd: validated.amountUsd,
      successUrl: `${origin}/settings/billing?topup=success`,
      cancelUrl: `${origin}/settings/billing?topup=canceled`,
    });

    return json({ checkoutUrl });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

export default function BillingSettings() {
  const {
    usageSummary,
    billingHistory,
    topups,
    topupConfig,
    billingEnabled,
    subscription,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [showDowngradeDialog, setShowDowngradeDialog] = useState(false);
  const [targetDowngradePlan, setTargetDowngradePlan] = useState<
    "FREE" | "PRO" | null
  >(null);
  const [customTopup, setCustomTopup] = useState<string>("");

  const handleTopup = (amountUsd: number) => {
    fetcher.submit(
      { intent: "topup", amountUsd: String(amountUsd) },
      { method: "POST" },
    );
  };

  const parsedCustom = Number(customTopup);
  const customValid =
    Number.isInteger(parsedCustom) &&
    parsedCustom >= topupConfig.minUsd &&
    parsedCustom % topupConfig.incrementUsd === 0;

  // Handle upgrade action
  const handleUpgrade = (planType: "PRO" | "MAX") => {
    fetcher.submit({ intent: "upgrade", planType }, { method: "POST" });
  };

  // Handle downgrade action
  const handleDowngrade = (planType: "FREE" | "PRO") => {
    setTargetDowngradePlan(planType);
    setShowDowngradeDialog(true);
  };

  // Confirm and execute downgrade
  const confirmDowngrade = () => {
    if (targetDowngradePlan) {
      fetcher.submit(
        { intent: "downgrade", planType: targetDowngradePlan },
        { method: "POST" },
      );
      setShowDowngradeDialog(false);
      setTargetDowngradePlan(null);
    }
  };

  // Determine if plan is upgrade, downgrade, or current
  const getPlanAction = (targetPlan: "FREE" | "PRO" | "MAX") => {
    const planOrder = { FREE: 0, PRO: 1, MAX: 2 };
    const currentOrder =
      planOrder[usageSummary.plan.type as keyof typeof planOrder];
    const targetOrder = planOrder[targetPlan];

    if (currentOrder === targetOrder) return "current";
    if (targetOrder > currentOrder) return "upgrade";
    return "downgrade";
  };

  // Handle plan selection
  const handlePlanSelect = (planType: "FREE" | "PRO" | "MAX") => {
    const action = getPlanAction(planType);

    if (action === "current") return;

    if (action === "upgrade") {
      handleUpgrade(planType as "PRO" | "MAX");
    } else {
      handleDowngrade(planType as "FREE" | "PRO");
    }
  };

  // Show success message after downgrade
  if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
    // Close modal and show message
    setTimeout(() => {
      setShowPlansModal(false);
      window.location.reload(); // Reload to show updated plan info
    }, 1500);
  }

  // Redirect to checkout/portal when URL is received
  if (
    fetcher.data &&
    "checkoutUrl" in fetcher.data &&
    fetcher.data.checkoutUrl
  ) {
    window.location.href = fetcher.data.checkoutUrl;
  }

  if (fetcher.data && "portalUrl" in fetcher.data && fetcher.data.portalUrl) {
    window.location.href = fetcher.data.portalUrl;
  }

  if (!billingEnabled) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-muted-foreground">
            Billing is disabled in self-hosted mode. You have unlimited usage.
          </p>
        </div>
      </div>
    );
  }

  if (!usageSummary) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-muted-foreground">
            No billing information available.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-auto flex-col gap-4 px-4 py-6 md:w-3xl">
      <SettingSection
        title="Billing"
        description=" Manage your subscription, usage, and billing history"
      >
        <>
          {/* Usage Section */}
          <div className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">Current Usage</h2>

            <div className="grid gap-4 md:grid-cols-3">
              {/* Credits Card */}
              <Card className="p-6">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">Credits</span>
                  <CreditCard className="text-muted-foreground h-4 w-4" />
                </div>
                <div className="mb-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">
                    {usageSummary.credits.available.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    / {usageSummary.credits.monthly.toLocaleString()} monthly
                  </span>
                </div>
                <Progress
                  segments={[{ value: usageSummary.credits.percentageUsed }]}
                  className="mb-2"
                  color="#c15e50"
                />
                <p className="text-muted-foreground text-sm">
                  {usageSummary.credits.percentageUsed}% used this period
                </p>
                {usageSummary.credits.topup > 0 && (
                  <div className="mt-3 flex items-center justify-between border-t pt-3">
                    <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
                      <Wallet className="h-3.5 w-3.5" />
                      Top-up balance
                    </span>
                    <span className="text-sm font-semibold">
                      {usageSummary.credits.topup.toLocaleString()}
                    </span>
                  </div>
                )}
              </Card>

              {/* Usage Breakdown */}
              <Card className="p-6">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">
                    Usage Breakdown
                  </span>
                  <TrendingUp className="text-muted-foreground h-4 w-4" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Facts</span>
                    <span className="font-medium">
                      {usageSummary.usage.episodes}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Searches</span>
                    <span className="font-medium">
                      {usageSummary.usage.searches}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Chat</span>
                    <span className="font-medium">
                      {usageSummary.usage.chat}
                    </span>
                  </div>
                </div>
              </Card>

              {/* Billing Cycle */}
              <Card className="p-6">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">
                    Billing Cycle
                  </span>
                  <Calendar className="text-muted-foreground h-4 w-4" />
                </div>
                <div className="mb-2">
                  <span className="text-3xl font-bold">
                    {usageSummary.billingCycle.daysRemaining}
                  </span>
                  <span className="text-muted-foreground"> days left</span>
                </div>
                <p className="text-muted-foreground text-sm">
                  Resets on{" "}
                  {new Date(usageSummary.billingCycle.end).toLocaleDateString()}
                </p>
              </Card>
            </div>

            {/* Overage Warning */}
            {usageSummary.credits.overage > 0 && (
              <Card className="mt-4 border-orange-500 bg-orange-50 p-4 dark:bg-orange-950">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  <div>
                    <h3 className="font-semibold text-orange-900 dark:text-orange-100">
                      Overage Usage Detected
                    </h3>
                    <p className="text-sm text-orange-700 dark:text-orange-300">
                      You've used {usageSummary.credits.overage} additional
                      credits beyond your monthly allocation.
                      {usageSummary.overage.enabled &&
                        usageSummary.overage.pricePerCredit && (
                          <>
                            {" "}
                            This will cost $
                            {(
                              usageSummary.credits.overage *
                              usageSummary.overage.pricePerCredit
                            ).toFixed(2)}{" "}
                            extra this month.
                          </>
                        )}
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Plan Section */}
          <div className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">Plan</h2>

            <Card className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-xl font-bold">
                      {usageSummary.plan.name}
                    </h3>
                    <Badge
                      variant={
                        usageSummary.plan.type === "FREE"
                          ? "secondary"
                          : "default"
                      }
                      className="rounded"
                    >
                      {usageSummary.plan.type}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {usageSummary.credits.monthly.toLocaleString()} credits/month
                    {usageSummary.overage.enabled && (
                      <>
                        {" "}
                        · ${usageSummary.overage.pricePerCredit}/credit overage
                      </>
                    )}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => setShowPlansModal(true)}
                >
                  View all plans
                </Button>
              </div>

              {subscription?.status === "CANCELED" &&
                subscription.planType !== "FREE" && (
                  <div className="mt-4 flex items-start gap-2 rounded-md bg-orange-50 p-3 dark:bg-orange-950">
                    <AlertCircle className="mt-0.5 h-4 w-4 text-orange-600 dark:text-orange-400" />
                    <p className="text-sm text-orange-700 dark:text-orange-300">
                      Downgrading to FREE plan on{" "}
                      <strong>
                        {new Date(
                          subscription.currentPeriodEnd,
                        ).toLocaleDateString()}
                      </strong>
                      . Your current credits and plan will remain active until
                      then.
                    </p>
                  </div>
                )}
            </Card>
          </div>

          {/* Top-up Section */}
          <div className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">Add credits</h2>

            <Card className="p-6">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-muted-foreground text-sm">
                  Top up any amount (multiples of ${topupConfig.incrementUsd},
                  min ${topupConfig.minUsd}). Credits never expire and stack on
                  top of your monthly plan.
                </p>
                <p className="text-sm font-medium">
                  ${1} = {topupConfig.creditsPerDollar} credits
                </p>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {[10, 20, 50, 100].map((amt) => (
                  <Button
                    key={amt}
                    variant="secondary"
                    disabled={fetcher.state === "submitting"}
                    onClick={() => handleTopup(amt)}
                    className="min-w-[100px] flex-col items-start px-4 py-6"
                  >
                    <span className="text-lg font-bold">${amt}</span>
                    <span className="text-muted-foreground text-xs">
                      +
                      {(
                        amt * topupConfig.creditsPerDollar
                      ).toLocaleString()}{" "}
                      credits
                    </span>
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[160px] flex-1">
                  <label
                    htmlFor="custom-topup"
                    className="text-muted-foreground mb-1 block text-xs"
                  >
                    Custom amount (USD)
                  </label>
                  <Input
                    id="custom-topup"
                    type="number"
                    min={topupConfig.minUsd}
                    step={topupConfig.incrementUsd}
                    value={customTopup}
                    onChange={(e) => setCustomTopup(e.target.value)}
                    placeholder={`${topupConfig.minUsd}`}
                  />
                </div>
                <Button
                  disabled={!customValid || fetcher.state === "submitting"}
                  onClick={() => handleTopup(parsedCustom)}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                  {customValid
                    ? ` ${(parsedCustom * topupConfig.creditsPerDollar).toLocaleString()} credits`
                    : " credits"}
                </Button>
              </div>
              {customTopup && !customValid && (
                <p className="text-muted-foreground mt-2 text-xs">
                  Enter a whole number that's at least $
                  {topupConfig.minUsd} and a multiple of $
                  {topupConfig.incrementUsd}.
                </p>
              )}

              {topups.length > 0 && (
                <div className="mt-6 border-t pt-4">
                  <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
                    Recent top-ups
                  </h3>
                  <div className="divide-y">
                    {topups.slice(0, 5).map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between py-2 text-sm"
                      >
                        <div>
                          <p className="font-medium">
                            ${t.amountUsd} ·{" "}
                            {t.credits.toLocaleString()} credits
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {new Date(t.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <Badge
                          variant={
                            t.status === "completed"
                              ? "default"
                              : t.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                          className="rounded"
                        >
                          {t.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Invoices Section */}
          <div className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">Invoices</h2>

            {billingHistory.length === 0 ? (
              <Card className="p-6">
                <p className="text-muted-foreground text-center">
                  No invoices yet
                </p>
              </Card>
            ) : (
              <Card>
                <div className="divide-y">
                  {billingHistory.map((invoice) => (
                    <div
                      key={invoice.id}
                      className="flex items-center justify-between p-4"
                    >
                      <div>
                        <p className="font-medium">
                          {new Date(invoice.periodStart).toLocaleDateString()} -{" "}
                          {new Date(invoice.periodEnd).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">
                          ${invoice.totalAmount.toFixed(2)}
                        </p>
                        <Badge
                          variant={
                            invoice.stripePaymentStatus === "paid"
                              ? "default"
                              : "destructive"
                          }
                          className="rounded"
                        >
                          {invoice.stripePaymentStatus || "pending"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      </SettingSection>

      {/* Plans Modal */}
      <Dialog open={showPlansModal} onOpenChange={setShowPlansModal}>
        <DialogContent className="max-w-5xl p-6">
          <DialogHeader>
            <DialogTitle>Choose Your CORE Plan</DialogTitle>
            <DialogDescription>
              Unlock the power of portable memory
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 md:grid-cols-3">
            {/* Free Plan */}
            <Card className="p-6">
              <div className="mb-4">
                <h3 className="text-xl font-bold">Free</h3>
                <p className="text-muted-foreground text-sm">
                  No credit card required
                </p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold">$0</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <ul className="mb-6 space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span>Credits: 3k/mo</span>
                </li>
                <li className="flex items-start gap-2">
                  <span>No usage based</span>
                </li>
              </ul>
              <Button
                className="w-full"
                variant="outline"
                disabled={
                  usageSummary.plan.type === "FREE" ||
                  fetcher.state === "submitting"
                }
                onClick={() => handlePlanSelect("FREE")}
              >
                {usageSummary.plan.type === "FREE"
                  ? "Current Plan"
                  : getPlanAction("FREE") === "downgrade"
                    ? "Downgrade to Free"
                    : "Try CORE for free"}
              </Button>
            </Card>

            {/* Pro Plan */}
            <Card className="border-primary p-6">
              <div className="mb-4">
                <h3 className="text-xl font-bold">Pro</h3>
                <p className="text-muted-foreground text-sm">
                  For Everyday Productivity
                </p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold">$19</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <ul className="mb-6 space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span>Credits: 15k/mo</span>
                </li>
                <li className="flex items-start gap-2">
                  <span>$0.299 /1K Additional Credits</span>
                </li>
              </ul>
              <Button
                className="w-full"
                variant="secondary"
                disabled={
                  usageSummary.plan.type === "PRO" ||
                  fetcher.state === "submitting"
                }
                onClick={() => handlePlanSelect("PRO")}
              >
                {usageSummary.plan.type === "PRO"
                  ? "Current Plan"
                  : getPlanAction("PRO") === "upgrade"
                    ? "Upgrade to PRO"
                    : "Downgrade to PRO"}
              </Button>
            </Card>

            {/* Max Plan */}
            <Card className="p-6">
              <div className="mb-4">
                <h3 className="text-xl font-bold">Max</h3>
                <p className="text-muted-foreground text-sm">
                  Get the most out of CORE
                </p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-bold">$99</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <ul className="mb-6 space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span>Credits: 100k/mo</span>
                </li>
                <li className="flex items-start gap-2">
                  <span>$0.249 /1K Additional Credits</span>
                </li>
              </ul>
              <Button
                className="w-full"
                variant="secondary"
                disabled={
                  usageSummary.plan.type === "MAX" ||
                  fetcher.state === "submitting"
                }
                onClick={() => handlePlanSelect("MAX")}
              >
                {usageSummary.plan.type === "MAX"
                  ? "Current Plan"
                  : "Upgrade to MAX"}
              </Button>
            </Card>
          </div>
        </DialogContent>
      </Dialog>

      {/* Downgrade Confirmation Dialog */}
      <AlertDialog
        open={showDowngradeDialog}
        onOpenChange={setShowDowngradeDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Downgrade</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to downgrade to the{" "}
              <strong>{targetDowngradePlan}</strong> plan? Your current credits
              will remain available until the end of your billing period, then
              you'll be switched to the {targetDowngradePlan} plan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDowngrade}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
