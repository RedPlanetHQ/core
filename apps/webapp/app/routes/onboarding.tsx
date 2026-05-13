import { Outlet, useFetcher, useLocation } from "@remix-run/react";
import Logo from "~/components/logo/logo";
import { Button } from "~/components/ui/button";

export default function OnboardingLayout() {
  const fetcher = useFetcher();
  const location = useLocation();
  const isSubmitting = fetcher.state !== "idle";

  // Skip is the escape hatch from the chat step. We hide it on the
  // name + gmail gates: name still needs a value, and gmail has its
  // own page-level Skip button.
  const isChatStep =
    location.pathname === "/onboarding" || location.pathname === "/onboarding/";

  return (
    <div className="flex h-[100vh] w-[100vw] flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 md:px-10">
        <div className="flex items-center gap-2 py-4">
          <div className="flex size-8 items-center justify-center rounded-md">
            <Logo size={60} />
          </div>
          <span className="font-mono font-medium">CORE</span>
        </div>
        {isChatStep && (
          <fetcher.Form method="post" action="/onboarding?index">
            <Button type="submit" variant="ghost" disabled={isSubmitting}>
              {isSubmitting ? "wrapping up…" : "i'm good, let's go"}
            </Button>
          </fetcher.Form>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
