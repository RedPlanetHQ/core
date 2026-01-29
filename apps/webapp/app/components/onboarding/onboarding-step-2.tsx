import { Button } from "~/components/ui";
import { LoaderCircle } from "lucide-react";
import { ClientOnly } from "remix-utils/client-only";
import { OnboardingSummary } from "./onboarding-summary.client";

interface OnboardingStep2Props {
  summary: string;
  onComplete?: () => void;
  isCompleting?: boolean;
}

export function OnboardingStep2({ summary, onComplete, isCompleting }: OnboardingStep2Props) {
  return (
    <div className="flex flex-col h-[calc(100vh_-_64px)] w-full items-center justify-center overflow-hidden">
      <div className="w-full overflow-y-auto flex h-full justify-center">
        <div className="flex max-w-3xl flex-col gap-8 pt-10">
          <div className="rounded-lg p-6">

            <ClientOnly
              fallback={
                <div className="flex w-full justify-center">
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                </div>
              }
            >
              {() => <OnboardingSummary summary={summary} />}
            </ClientOnly>

          </div>
        </div>
      </div>

      <div className="space-y-4 shrink-0 flex w-full flex-col items-center justify-center border-t-1 border-gray-300">
        <div className="flex max-w-3xl justify-between flex-wrap w-full py-2 items-center">
          <h3 className="text-md">next step: connect your digital brain to agents</h3>


          <div className="flex justify-end">
            <Button
              size="lg"
              variant="secondary"
              onClick={onComplete}
              disabled={isCompleting}
              isLoading={isCompleting}
            >
              connect to agents
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
