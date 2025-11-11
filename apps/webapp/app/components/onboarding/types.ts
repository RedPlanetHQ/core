export enum Provider {
  AMP = "amp",
  AUGMENT_CODE = "augment-code",
  CHATGPT = "chatgpt",
  CLAUDE_CODE = "claude-code",
  CLAUDE = "claude",
  CLINE = "cline",
  CODEX = "codex",
  COPILOT_CLI = "copilot-cli",
  COPILOT_CODING_AGENT = "copilot-coding-agent",
  CRUSH = "crush",
  CURSOR = "cursor",
  FACTORY = "factory",
  GEMINI = "gemini",
  KILO_CODE = "kilo-code",
  KIRO = "kiro",
  OPENCODE = "opencode",
  PERPLEXITY = "perplexity",
  QODO_GEN = "qodo-gen",
  QWEN_CODER = "qwen-coder",
  ROO_CODE = "roo-code",
  ROVO_DEV = "rovo-dev",
  TRAE = "trae",
  VSCODE = "vscode",
  VSCODE_INSIDERS = "vscode-insiders",
  WARP = "warp",
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
