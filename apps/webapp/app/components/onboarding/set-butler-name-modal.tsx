import { useFetcher } from "@remix-run/react";
import { useState } from "react";
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
  const nameFetcher = useFetcher<{ name?: string }>();
  const isSubmitting = fetcher.state !== "idle";
  const isGenerating = nameFetcher.state !== "idle";
  const [generatedName, setGeneratedName] = useState<string | undefined>();

  const handleComplete = (name: string, slug: string) => {
    fetcher.submit({ name, slug }, { method: "POST", action: "/home" });
  };

  const handleGenerateName = (currentName: string, previousNames: string[]) => {
    nameFetcher.submit(
      {
        intent: "generate_name",
        currentName,
        previousNames: JSON.stringify(previousNames),
      },
      { method: "POST", action: "/onboarding/name" },
    );
  };

  // Pick up generated name from fetcher data
  const fetchedName = nameFetcher.data?.name;
  const effectiveGeneratedName = fetchedName ?? generatedName;

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
          onGenerateName={handleGenerateName}
          generatedName={effectiveGeneratedName}
          isGenerating={isGenerating}
        />
      </DialogContent>
    </Dialog>
  );
}
