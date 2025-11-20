import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireUser, requireWorkpace } from "~/services/session.server";
import { getUsageSummary } from "~/services/billing.server";
import {
  createCheckoutSession,
  createBillingPortalSession,
  downgradeSubscription,
} from "~/services/stripe.server";
import { CreditCard, TrendingUp, Calendar, AlertCircle } from "lucide-react";
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
import { isBillingEnabled } from "~/config/billing.server";
import { SettingSection } from "~/components/setting-section";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await requireWorkpace(request);

  // Get usage summary
  const usageSummary = await getUsageSummary(workspace.id);

  // Get billing history
  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId: workspace.id },
    include: {
      BillingHistory: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  const billingEnabled = isBillingEnabled();

  return json({
    user,
    workspace,
    usageSummary: usageSummary as any,
    billingHistory: subscription?.BillingHistory || [],
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
  const workspace = await requireWorkpace(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upgrade") {
    const planType = formData.get("planType") as "PRO" | "MAX";
    const origin = new URL(request.url).origin;

    const checkoutUrl = await createCheckoutSession({
      workspaceId: workspace.id,
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
      workspaceId: workspace.id,
      returnUrl: `${origin}/settings/billing`,
    });

    return json({ portalUrl });
  }

  if (intent === "downgrade") {
    const targetPlan = formData.get("planType") as "FREE" | "PRO";

    // Downgrade subscription - keeps credits until period end, then switches to new plan
    await downgradeSubscription({
      workspaceId: workspace.id,
      newPlanType: targetPlan,
    });

    return json({
      success: true,
      message: `Successfully scheduled downgrade to ${targetPlan}. Your current credits will remain available until the end of your billing period.`,
    });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

export default function BillingSettings() {
  const { usageSummary, billingHistory, billingEnabled, subscription } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [showDowngradeDialog, setShowDowngradeDialog] = useState(false);
  const [targetDowngradePlan, setTargetDowngradePlan] = useState<
    "FREE" | "PRO" | null
  >(null);

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
    <div className="mx-auto flex w-3xl flex-col gap-4 px-4 py-6">
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
                <div className="mb-2">
                  <span className="text-3xl font-bold">
                    {usageSummary.credits.available}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    / {usageSummary.credits.monthly}
                  </span>
                </div>
                <Progress
                  segments={[
                    { value: 100 - usageSummary.credits.percentageUsed },
                  ]}
                  className="mb-2"
                  color="#c15e50"
                />
                <p className="text-muted-foreground text-sm">
                  {usageSummary.credits.percentageUsed}% used this period
                </p>
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
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Plan</h2>
              <Button
                variant="secondary"
                onClick={() => setShowPlansModal(true)}
              >
                View All Plans
              </Button>
            </div>

            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
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
                    {usageSummary.credits.monthly} credits/month
                    {usageSummary.overage.enabled && (
                      <>
                        {" "}
                        + ${usageSummary.overage.pricePerCredit}/credit overage
                      </>
                    )}
                  </p>
                  {subscription?.status === "CANCELED" &&
                    subscription.planType !== "FREE" && (
                      <div className="mt-3 flex items-start gap-2 rounded-md bg-orange-50 p-3 dark:bg-orange-950">
                        <AlertCircle className="mt-0.5 h-4 w-4 text-orange-600 dark:text-orange-400" />
                        <p className="text-sm text-orange-700 dark:text-orange-300">
                          Downgrading to FREE plan on{" "}
                          <strong>
                            {new Date(
                              subscription.currentPeriodEnd,
                            ).toLocaleDateString()}
                          </strong>
                          . Your current credits and plan will remain active
                          until then.
                        </p>
                      </div>
                    )}
                </div>
              </div>
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
