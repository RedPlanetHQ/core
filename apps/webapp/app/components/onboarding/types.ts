export enum Provider {
  CHATGPT = "chatgpt",
  CLAUDE_CODE = "claude-code",
  CLAUDE = "claude",
  CODEX = "codex",
  CURSOR = "cursor",
  GEMINI = "gemini",
  KILO_CODE = "kilo-code",
  VSCODE = "vscode",
  WINDSURF = "windsurf",
  ZED = "zed",
}

export enum OnboardingStep {
  PROVIDER_SELECTION = "provider_selection",
  FIRST_INGESTION = "first_ingestion",
  VERIFICATION = "verification",
  COMPLETE = "complete",
}

export interface ProviderConfig {
  id: Provider;
  name: string;
  description: string;
  docsUrl: string;
  icon: string;
  installationSteps: Array<{
    title: string;
    component: React.ReactNode;
  }>;
}

export interface OnboardingState {
  currentStep: OnboardingStep;
  selectedProvider?: Provider;
  isConnected: boolean;
  ingestionStatus: "idle" | "waiting" | "processing" | "complete" | "error";
  verificationResult?: string;
  error?: string;
}
