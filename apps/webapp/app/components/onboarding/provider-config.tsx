import { Provider, type ProviderConfig } from "./types";
import { Button } from "../ui";
import { StepCodeBlock, StepInfoBox } from "./installation-steps";

export const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  [Provider.CHATGPT]: {
    id: Provider.CHATGPT,
    name: "ChatGPT",
    description:
      "Connect ChatGPT to CORE's memory system via browser extension",
    docsUrl: "https://docs.heysol.ai/providers/browser-extension",
    icon: "chatgpt",
    installationSteps: [
      {
        title: "Install Core Browser Extension",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div className="text-xs text-gray-500">
                Install from Chrome Web Store or Firefox Add-ons
              </div>
              <Button
                variant="default"
                size="sm"
                className="pointer-events-none"
              >
                Add Extension
              </Button>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Open ChatGPT",
        component: (
          <p className="text-muted-foreground text-sm">
            Navigate to ChatGPT in your browser at chat.openai.com
          </p>
        ),
      },
      {
        title: "Authenticate Core Extension",
        component: (
          <p className="text-muted-foreground text-sm">
            Click on the Core extension icon and sign in to connect your
            account.
          </p>
        ),
      },
      {
        title: "Start using Core with ChatGPT",
        component: (
          <p className="text-muted-foreground text-sm">
            Your ChatGPT conversations will now be captured by Core's memory
            system.
          </p>
        ),
      },
    ],
  },
  [Provider.CLAUDE_CODE]: {
    id: Provider.CLAUDE_CODE,
    name: "Claude Code CLI",
    description: "Connect your Claude Code CLI to CORE's memory system",
    docsUrl: "https://docs.heysol.ai/providers/claude-code",
    icon: "claude",
    installationSteps: [
      {
        title: "Install Core MCP Server",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Run in terminal:</div>
              <code className="text-sm">npx @composio/core-mcp install</code>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Authenticate Core",
        component: (
          <p className="text-muted-foreground text-sm">
            Follow the authentication prompts in your terminal to connect Core.
          </p>
        ),
      },
      {
        title: "Start using Core in Claude Code",
        component: (
          <p className="text-muted-foreground text-sm">
            Core is now available in your Claude Code CLI sessions.
          </p>
        ),
      },
    ],
  },
  [Provider.CLAUDE]: {
    id: Provider.CLAUDE,
    name: "Claude",
    description: "Connect your Claude Desktop app to CORE's memory system",
    docsUrl: "https://docs.heysol.ai/providers/claude",
    icon: "claude",
    installationSteps: [
      {
        title: "Open Claude Desktop App Settings",
        component: (
          <p className="text-muted-foreground text-sm">
            Navigate to Settings in your Claude Desktop application.
          </p>
        ),
      },
      {
        title: "Add Core MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Add to MCP Settings:</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core": {
      "command": "npx",
      "args": ["-y", "@composio/core-mcp"],
      "env": {}
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Restart Claude Desktop",
        component: (
          <p className="text-muted-foreground text-sm">
            Close and reopen Claude Desktop for the changes to take effect.
          </p>
        ),
      },
      {
        title: "Authenticate Core",
        component: (
          <p className="text-muted-foreground text-sm">
            Look for Core in your available tools and authenticate when
            prompted.
          </p>
        ),
      },
    ],
  },
  [Provider.CODEX]: {
    id: Provider.CODEX,
    name: "Codex",
    description: "Connect your Codex CLI to CORE's memory system",
    docsUrl: "https://docs.heysol.ai/providers/codex",
    icon: "chatgpt",
    installationSteps: [
      {
        title: "Add Core MCP Server to Codex Config",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div className="text-xs text-gray-500">
                Add to ~/.codex/config.toml:
              </div>
              <pre className="text-xs">
                {`[[mcp_servers]]
url = "https://core.heysol.ai/api/v1/mcp?source=Codex"
type = "http"`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Restart Codex CLI",
        component: (
          <p className="text-muted-foreground text-sm">
            Close and reopen your Codex CLI for the changes to take effect.
          </p>
        ),
      },
      {
        title: "Authenticate Core",
        component: (
          <p className="text-muted-foreground text-sm">
            Look for Core in your available tools and authenticate when
            prompted.
          </p>
        ),
      },
    ],
  },
  [Provider.CURSOR]: {
    id: Provider.CURSOR,
    name: "Cursor",
    description: "Connect your Cursor Desktop app to CORE's memory system",
    docsUrl: "https://docs.heysol.ai/providers/cursor",
    icon: "cursor",
    installationSteps: [
      {
        title: "Click on Add to Cursor",
        component: (
          <Button variant="default" size="lg" className="pointer-events-none">
            Add To Cursor
          </Button>
        ),
      },
      {
        title: `Click on Install in "Install MCP Server?" Section`,
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Install MCP Server?</div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Name:</span>
                  <span>core</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Type:</span>
                  <span>streamableHttp</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">URL:</span>
                  <span className="text-xs">
                    https://core.composio.dev/mcp?agent=cursor
                  </span>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="pointer-events-none"
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="pointer-events-none"
                >
                  Install
                </Button>
              </div>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: `Click on "Needs Login" under Core in MCP Tools Section`,
        component: (
          <StepInfoBox>
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-full">
                <span className="text-primary text-sm font-medium">C</span>
              </div>
              <div className="flex-1">
                <div className="font-medium">core</div>
                <div className="flex items-center gap-1 text-xs text-yellow-600">
                  <div className="h-2 w-2 rounded-full bg-yellow-500" />
                  Needs login
                </div>
              </div>
              <div className="flex h-8 w-12 items-center justify-center rounded-full bg-gray-200" />
            </div>
          </StepInfoBox>
        ),
      },
      {
        title:
          "Authenticate and start using 500+ apps with Core in Cursor chat.",
        component: (
          <p className="text-muted-foreground text-sm">
            Once authenticated, you'll have access to all Core features within
            Cursor.
          </p>
        ),
      },
    ],
  },
  [Provider.GEMINI]: {
    id: Provider.GEMINI,
    name: "Gemini",
    description: "Connect Gemini CLI to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/gemini",
    icon: "gemini",
    installationSteps: [
      {
        title: "Add Core MCP Server to Gemini Config",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div className="text-xs text-gray-500">
                Add to ~/.gemini/settings.json:
              </div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core": {
      "url": "https://core.heysol.ai/api/v1/mcp?source=Gemini",
      "transport": "http"
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Restart Gemini CLI",
        component: (
          <p className="text-muted-foreground text-sm">
            Close and reopen your Gemini CLI for the changes to take effect.
          </p>
        ),
      },
      {
        title: "Authenticate Core",
        component: (
          <p className="text-muted-foreground text-sm">
            Look for Core in your available tools and authenticate when
            prompted.
          </p>
        ),
      },
    ],
  },
  [Provider.KILO_CODE]: {
    id: Provider.KILO_CODE,
    name: "Kilo-Code",
    description: "Connect Kilo Code Agent to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/kilo-code",
    icon: "kilo",
    installationSteps: [],
  },
  [Provider.VSCODE]: {
    id: Provider.VSCODE,
    name: "VS Code (Github Copilot)",
    description: "Connect your VS Code editor to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/vscode",
    icon: "vscode",
    installationSteps: [],
  },
  [Provider.WINDSURF]: {
    id: Provider.WINDSURF,
    name: "Windsurf",
    description: "Connect your Windsurf editor to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/windsurf",
    icon: "windsurf",
    installationSteps: [],
  },
  [Provider.ZED]: {
    id: Provider.ZED,
    name: "Zed",
    description: "Connect your Zed editor to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/zed",
    icon: "zed",
    installationSteps: [],
  },
};

export const SUGGESTED_INGESTION_PROMPTS = [
  "I'm a full-stack developer working on a React and Node.js application. I prefer TypeScript, functional programming patterns, and writing comprehensive tests.",
  "I'm working on a machine learning project using Python and PyTorch. I focus on computer vision and prefer Jupyter notebooks for exploration.",
  "I'm a DevOps engineer managing Kubernetes clusters. I work primarily with Terraform, Helm, and CI/CD pipelines using GitHub Actions.",
];

export const VERIFICATION_PROMPT = "Who am I? Tell me what you know about me.";
