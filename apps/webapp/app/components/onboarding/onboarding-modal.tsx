import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui";
import { type Provider, OnboardingStep } from "./types";
import { ProviderSelectionStep } from "./provider-selection-step";
import { InstallationStepsView } from "./installation-steps-view";
import { PROVIDER_CONFIGS } from "./provider-config";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  preselectedProvider?: Provider;
}

export function OnboardingModal({
  isOpen,
  onClose,
  onComplete,
  preselectedProvider,
}: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(
    preselectedProvider
      ? OnboardingStep.INSTALLATION_STEPS
      : OnboardingStep.PROVIDER_SELECTION,
  );
  const [selectedProvider, setSelectedProvider] = useState<
    Provider | undefined
  >(preselectedProvider);


  const handleProviderSelect = (provider: Provider) => {
    setSelectedProvider(provider);
  };

  const handleContinueFromProvider = () => {
    setCurrentStep(OnboardingStep.INSTALLATION_STEPS);
  };

  const handleBack = () => {
    setCurrentStep(OnboardingStep.PROVIDER_SELECTION);
  };

  const handleComplete = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("onboarding_completed", "true");
    }
    setCurrentStep(OnboardingStep.COMPLETE);
    onComplete();
    onClose();
  };

  const handleSkip = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("onboarding_completed", "true");
    }
    onComplete();
    onClose();
  };



  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[70vh] max-w-3xl overflow-y-auto p-4">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {currentStep === OnboardingStep.INSTALLATION_STEPS && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="gap-1 px-2 rounded"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle className="text-xl">Connect to Core {selectedProvider ? `with ${PROVIDER_CONFIGS[selectedProvider].name}` : null}</DialogTitle>
          </div>
        </DialogHeader>

        <div>
          {currentStep === OnboardingStep.PROVIDER_SELECTION && (
            <ProviderSelectionStep
              selectedProvider={selectedProvider}
              onSelectProvider={handleProviderSelect}
              onContinue={handleContinueFromProvider}
              showInstallationSteps={false}
            />
          )}

          {currentStep === OnboardingStep.INSTALLATION_STEPS &&
            selectedProvider && (
              <InstallationStepsView
                provider={selectedProvider}
                providerConfig={PROVIDER_CONFIGS[selectedProvider]}
                onComplete={handleComplete}
              />
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
