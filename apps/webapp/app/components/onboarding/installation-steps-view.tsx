import { ExternalLink } from "lucide-react";
import { Button } from "../ui";
import { type Provider, type ProviderConfig } from "./types";
import { InstallationSteps } from "./installation-steps";

interface InstallationStepsViewProps {
  provider: Provider;
  providerConfig: ProviderConfig;
  onComplete: () => void;
}

export function InstallationStepsView({
  providerConfig,
  onComplete,
}: InstallationStepsViewProps) {
  return (
    <div className="space-y-4">
      <InstallationSteps
        title={`Connect Core in ${providerConfig.name}`}
        steps={providerConfig.installationSteps}
      />

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <a
          href={providerConfig.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:bg-grayAlpha-200 inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium transition-colors"
        >
          View Full Documentation
          <ExternalLink className="h-4 w-4" />
        </a>

        <Button onClick={onComplete} size="lg" variant="secondary">
          Done
        </Button>
      </div>
    </div>
  );
}
