import { useFetcher } from "@remix-run/react";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { OnboardingAgentName } from "./onboarding-agent-name";

interface SetButlerNameModalProps {
  defaultName: string;
  defaultSlug: string;
  workspaceId: string;
}

export function SetButlerNameModal({
  defaultName,
  defaultSlug,
  workspaceId,
}: SetButlerNameModalProps) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  const handleComplete = (name: string, slug: string) => {
    fetcher.submit({ name, slug }, { method: "POST", action: "/home" });
  };

  return (
    <Dialog open modal>
      <DialogContent
        className="max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <OnboardingAgentName
          defaultName={defaultName}
          defaultSlug={defaultSlug}
          workspaceId={workspaceId}
          onComplete={handleComplete}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}
