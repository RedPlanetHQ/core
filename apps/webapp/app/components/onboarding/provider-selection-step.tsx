import { Button } from "../ui";
import { PROVIDER_CONFIGS } from "./provider-config";
import { type Provider } from "./types";
import { getIconForAuthorise } from "../icon-utils";

interface ProviderSelectionStepProps {
  selectedProvider?: Provider;
  onSelectProvider: (provider: Provider) => void;
  onContinue: () => void;
  showInstallationSteps?: boolean;
}

export function ProviderSelectionStep({
  selectedProvider,
  onSelectProvider,
  onContinue,
}: ProviderSelectionStepProps) {
  const providers = Object.values(PROVIDER_CONFIGS);

  return (
    <div className="space-y-4">
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
              onClick={() => {
                onSelectProvider(provider.id);
                onContinue();
              }}
              size="2xl"
              className={`relative flex flex-col items-start justify-center gap-1 rounded-lg border-1 border-gray-300 p-4 text-left transition-all ${isSelected
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

    </div>
  );
}
