import { Provider, type ProviderConfig } from "./types";

export const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  [Provider.CHATGPT]: {
    id: Provider.CHATGPT,
    name: "ChatGPT",
    description: "Connect ChatGPT to CORE's memory system via browser extension",
    docsUrl: "https://docs.heysol.ai/providers/browser-extension",
    icon: "chatgpt",
  },
  [Provider.CLAUDE_CODE]: {
    id: Provider.CLAUDE_CODE,
    name: "Claude Code CLI",
    description: "Connect your Claude Code CLI to CORE's memory system",
    docsUrl: "https://docs.heysol.ai/providers/claude-code",
    icon: "claude",
  },
  [Provider.CLAUDE]: {
    id: Provider.CLAUDE,
    name: "Claude",
    description: "Connect your Claude Desktop app to CORE's memory system",
    docsUrl: "https://docs.heysol.ai/providers/claude",
    icon: "claude",
  },
  [Provider.CODEX]: {
    id: Provider.CODEX,
    name: "Codex",
    description: "Connect your Codex CLI to CORE's memory system",
    docsUrl: "https://docs.heysol.ai/providers/codex",
    icon: "codex",
  },
  [Provider.CURSOR]: {
    id: Provider.CURSOR,
    name: "Cursor",
    description: "Connect your Cursor Desktop app to CORE's memory system",
    docsUrl: "https://docs.heysol.ai/providers/cursor",
    icon: "cursor",
  },
  [Provider.GEMINI]: {
    id: Provider.GEMINI,
    name: "Gemini",
    description: "Connect Gemini to CORE's memory system via browser extension",
    docsUrl: "https://docs.heysol.ai/providers/browser-extension",
    icon: "gemini",
  },
  [Provider.KILO_CODE]: {
    id: Provider.KILO_CODE,
    name: "Kilo-Code",
    description: "Connect Kilo Code Agent to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/kilo-code",
    icon: "kilo-code",
  },
  [Provider.VSCODE]: {
    id: Provider.VSCODE,
    name: "VS Code (Github Copilot)",
    description: "Connect your VS Code editor to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/vscode",
    icon: "vscode",
  },
  [Provider.WINDSURF]: {
    id: Provider.WINDSURF,
    name: "Windsurf",
    description: "Connect your Windsurf editor to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/windsurf",
    icon: "windsurf",
  },
  [Provider.ZED]: {
    id: Provider.ZED,
    name: "Zed",
    description: "Connect your Zed editor to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/zed",
    icon: "zed",
  },
};

export const SUGGESTED_INGESTION_PROMPTS = [
  "I'm a full-stack developer working on a React and Node.js application. I prefer TypeScript, functional programming patterns, and writing comprehensive tests.",
  "I'm working on a machine learning project using Python and PyTorch. I focus on computer vision and prefer Jupyter notebooks for exploration.",
  "I'm a DevOps engineer managing Kubernetes clusters. I work primarily with Terraform, Helm, and CI/CD pipelines using GitHub Actions.",
];

export const VERIFICATION_PROMPT = "Who am I? Tell me what you know about me.";
