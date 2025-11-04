import { ExternalLink } from "lucide-react";
import { Button } from "../ui";
import { PROVIDER_CONFIGS } from "./provider-config";
import { type Provider } from "./types";
import { getIconForAuthorise } from "../icon-utils";
import { type InstallationStep, InstallationSteps } from "./installation-steps";

interface ProviderSelectionStepProps {
  selectedProvider?: Provider;
  onSelectProvider: (provider: Provider) => void;
  onContinue: () => void;
}

export function ProviderSelectionStep({
  selectedProvider,
  onSelectProvider,
  onContinue,
}: ProviderSelectionStepProps) {
  const providers = Object.values(PROVIDER_CONFIGS);

  // Example installation steps for when a provider is selected
  // This can be customized per provider
  const getInstallationSteps = (provider: Provider): InstallationStep[] => {
    const providerConfig = PROVIDER_CONFIGS[provider];

    // Example steps - customize based on the provider
    return providerConfig.installationSteps;
  };

  return (
    <div className="space-y-2">
      <div>
        <h2 className="mb-2 text-xl font-semibold">Choose Your Provider</h2>
        <p className="text-muted-foreground text-sm">
          Select the application you'll use to connect with Core
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => {
          const isSelected = selectedProvider === provider.id;
          return (
            <Button
              key={provider.id}
              variant="outline"
              onClick={() => onSelectProvider(provider.id)}
              size="2xl"
              className={`relative flex flex-col items-start justify-center gap-1 rounded-lg border-1 border-gray-300 p-4 text-left transition-all ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "hover:border-primary/50 border-gray-300"
              }`}
            >
              <div className="flex h-full items-center gap-2">
                {getIconForAuthorise(provider.icon, 20)}
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{provider.name}</h3>
                </div>
              </div>
            </Button>
          );
        })}
      </div>

      {selectedProvider && (
        <div className="mt-4 space-y-4 border-t border-gray-300 p-4">
          <InstallationSteps
            title={`Connect Core in ${PROVIDER_CONFIGS[selectedProvider].name}`}
            steps={getInstallationSteps(selectedProvider)}
          />

          <div className="mt-4 flex items-center gap-2 border-t border-gray-200 pt-4">
            <a
              href={PROVIDER_CONFIGS[selectedProvider].docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:bg-grayAlpha-200 inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium transition-colors"
            >
              View Full Documentation
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={onContinue}
          disabled={!selectedProvider}
          size="lg"
          variant="secondary"
        >
          Continue to Setup
        </Button>
      </div>
    </div>
  );
}
