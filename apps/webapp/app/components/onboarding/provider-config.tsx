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
          <div className="space-y-2">
            <a
              href="https://chromewebstore.google.com/detail/core-extension/cglndoindnhdbfcbijikibfjoholdjcc"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="default" className="rounded">
                Add Extension
              </Button>
            </a>
          </div>
        ),
      },
      {
        title: "Generate and Add API Key from CORE Dashboard",
        component: (
          <p className="text-muted-foreground text-sm">
            Go to Settings → API Key → Generate new key → Name it "extension"
          </p>
        ),
      },
      {
        title: "Add API Key in Core Extension",
        component: (
          <p className="text-muted-foreground text-sm">
            Paste your API key and click Save. Once connected, you'll see API
            key configured account.
          </p>
        ),
      },
    ],
  },
  [Provider.CLAUDE_CODE]: {
    id: Provider.CLAUDE_CODE,
    name: "Claude Code CLI",
    description: "Install CORE in Claude Code CLI",
    docsUrl: "https://docs.heysol.ai/providers/claude-code",
    icon: "claude",
    installationSteps: [
      {
        title: "Copy setup command and run in your terminal",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Run in terminal:</div>
              <code className="text-sm">
                claude mcp add --transport http core-memory
                https://core.heysol.ai/api/v1/mcp?source=Claude-Code
              </code>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Run /mcp command in claude code",
        component: (
          <p className="text-muted-foreground text-sm">
            Verify installation, you should see core-memory listed among MCP
            servers.
          </p>
        ),
      },
      {
        title: "Authenticate CORE MCP server",
        component: (
          <p className="text-muted-foreground text-sm">
            Open core-memory server and cick on Authenticate
          </p>
        ),
      },
      {
        title: "Enable automatic memory integration",
        component: (
          <p className="text-muted-foreground text-sm">
            Create sub-agents from this{" "}
            <a
              href="https://docs.heysol.ai/providers/claude-code#enable-automatic-memory-integration-recommended"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              guide
            </a>{" "}
            to auto search and store memories from each session.
          </p>
        ),
      },
    ],
  },
  [Provider.CLAUDE]: {
    id: Provider.CLAUDE,
    name: "Claude",
    description: "Install CORE in Claude Desktop app",
    docsUrl: "https://docs.heysol.ai/providers/claude",
    icon: "claude",
    installationSteps: [
      {
        title: "Copy CORE MCP URL",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <code className="text-sm">
                https://core.heysol.ai/api/v1/mcp?source=Claude
              </code>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Add CORE connector",
        component: (
          <p className="text-muted-foreground text-sm">
            Navigate to Settings → Connectors → Click Add custom connector
          </p>
        ),
      },
      {
        title: "Authenticate with CORE",
        component: (
          <p className="text-muted-foreground text-sm">
            Click on "Connect" and grant claude permission to acces CORE MCP
          </p>
        ),
      },
      {
        title: "Enable automatic memory integration",
        component: (
          <p className="text-muted-foreground text-sm">
            Add following instructions in preferences from this{" "}
            <a
              href="https://docs.heysol.ai/providers/claude#enable-automatic-memory-integration-recommended"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              guide
            </a>{" "}
            to auto search and store memories from each session.
          </p>
        ),
      },
    ],
  },
  [Provider.CODEX]: {
    id: Provider.CODEX,
    name: "Codex",
    description: "Install CORE in Codex CLI",
    docsUrl: "https://docs.heysol.ai/providers/codex",
    icon: "chatgpt",
    installationSteps: [
      {
        title: "Add the following to your ~/.codex/config.toml file:",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <pre className="text-xs">
                {`model = "gpt-5-codex"
model_reasoning_effort = "medium"
trust_level = "trusted"

[features]
rmcp_client = true

[mcp_servers.memory]
url = "https://core.heysol.ai/api/v1/mcp?source=codex"`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },

      {
        title: "Enable automatic memory integration",
        component: (
          <p className="text-muted-foreground text-sm">
            Add the following instructions from this{" "}
            <a
              href="https://docs.heysol.ai/providers/codex#enable-automatic-memory-integration-recommended"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              guide
            </a>{" "}
            in AGENTS.md file
          </p>
        ),
      },
    ],
  },
  [Provider.CURSOR]: {
    id: Provider.CURSOR,
    name: "Cursor",
    description: "Install CORE in Cursor IDE",
    docsUrl: "https://docs.heysol.ai/providers/cursor",
    icon: "cursor",
    installationSteps: [
      {
        title: "Click on Add to Cursor",
        component: (
          <a
            href="cursor://mcp/install?name=core-memory&type=streamableHttp&url=https://core.heysol.ai/api/v1/mcp?source=cursor"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="default" size="lg">
              Add To Cursor
            </Button>
          </a>
        ),
      },
      {
        title: `Click on Install in "Install MCP Server?" Section`,
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Install MCP Server?</div>
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
                    https://core.heysol.ai/api/v1/mcp?source=cursor
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
                <div className="font-medium">core-memory</div>
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
    ],
  },
  [Provider.GEMINI]: {
    id: Provider.GEMINI,
    name: "Gemini",
    description: "Install CORE in Gemini via browser extension",
    docsUrl: "https://docs.heysol.ai/providers/browser-extension",
    icon: "gemini",
    installationSteps: [
      {
        title: "Install Core Browser Extension",
        component: (
          <div className="space-y-2">
            <a
              href="https://chromewebstore.google.com/detail/core-extension/cglndoindnhdbfcbijikibfjoholdjcc"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="default">Add Extension</Button>
            </a>
          </div>
        ),
      },
      {
        title: "Generate and Add API Key from CORE Dashboard",
        component: (
          <p className="text-muted-foreground text-sm">
            Go to Settings → API Key → Generate new key → Name it “extension”
          </p>
        ),
      },
      {
        title: "Add API Key in Core Extension",
        component: (
          <p className="text-muted-foreground text-sm">
            Paste your API key and click Save. Once connected, you’ll see API
            key configured account.
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
    installationSteps: [
      {
        title: "Open MCP Settings",
        component: (
          <p className="text-muted-foreground text-sm">
            Go to Settings → MCP Servers → Installed tab → click Edit Global MCP
            to edit your configuration.
          </p>
        ),
      },
      {
        title: "Add CORE MCP Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add to your MCP config file:</div>
              <pre className="text-xs">
                {`{
  "core-memory": {
    "type": "streamable-http",
    "url": "https://core.heysol.ai/api/v1/mcp?source=Kilo-Code",
    "headers": {
      "Authorization": "Bearer your-token"
    },
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.VSCODE]: {
    id: Provider.VSCODE,
    name: "VS Code (Github Copilot)",
    description: "Connect your VS Code editor to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/vscode",
    icon: "vscode",
    installationSteps: [
      {
        title: "Add CORE MCP Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Enter the below in mcp.json file:</div>
              <pre className="text-xs">
                {`{
  "servers": {
    "core-memory": {
      "url": "https://core.heysol.ai/api/v1/mcp?source=Vscode",
      "type": "http"
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.WINDSURF]: {
    id: Provider.WINDSURF,
    name: "Windsurf",
    description: "Connect your Windsurf editor to CORE's memory system via MCP",
    docsUrl: "https://docs.heysol.ai/providers/windsurf",
    icon: "windsurf",
    installationSteps: [
      {
        title: "Add CORE MCP Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Enter the below in mcp_config.json file:</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core-memory": {
      "serverUrl": "https://core.heysol.ai/api/v1/mcp/source=windsurf",
      "headers": {
        "Authorization": "Bearer <YOUR_API_KEY>"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Generate and Add API Key from CORE Dashboard",
        component: (
          <p className="text-muted-foreground text-sm">
            Go to Settings → API Key → Generate new key → Name it "windsurf"
          </p>
        ),
      },
      {
        title: "Enable automatic memory integration",
        component: (
          <p className="text-muted-foreground text-sm">
            Add the following instructions from this{" "}
            <a
              href="https://docs.heysol.ai/providers/windsurf#enable-automatic-memory-integration-recommended"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              guide
            </a>{" "}
            in AGENTS.md file
          </p>
        ),
      },
    ],
  },
  [Provider.ZED]: {
    id: Provider.ZED,
    name: "Zed",
    description: "Install CORE in Zed IDE",
    docsUrl: "https://docs.heysol.ai/providers/zed",
    icon: "zed",
    installationSteps: [
      {
        title: "Go to Settings in Agent Panel -> Add Custom Server",
        component: (
          <p className="text-muted-foreground text-sm">
            Navigate to Settings in Agent Panel and click on Add Custom Server
          </p>
        ),
      },
      {
        title: "Add CORE MCP Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>
                Enter below code in configuration file and click on Add server
                button:
              </div>
              <pre className="text-xs">
                {`{
  "core-memory": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://core.heysol.ai/api/v1/mcp?source=Zed"]
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.VSCODE_INSIDERS]: {
    id: Provider.VSCODE_INSIDERS,
    name: "VS Code Insiders",
    description: "Install CORE in VS Code Insiders",
    docsUrl: "https://docs.heysol.ai/providers/vscode-insiders",
    icon: "vscode",
    installationSteps: [
      {
        title: "Add CORE MCP Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add to your VS Code Insiders MCP config:</div>
              <pre className="text-xs">
                {`"mcp": {
  "servers": {
    "core-memory": {
      "type": "http",
      "url": "https://core.heysol.ai/api/v1/mcp?source=VSCode-Insiders",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Reload VS Code Insiders Window",
        component: (
          <p className="text-muted-foreground text-sm">
            Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux) and run
            "Developer: Reload Window"
          </p>
        ),
      },
    ],
  },
  [Provider.AMP]: {
    id: Provider.AMP,
    name: "Amp",
    description: "Install CORE in Amp code editor",
    docsUrl: "https://docs.heysol.ai/providers/amp",
    icon: "amp",
    installationSteps: [
      {
        title: "Copy setup command and run in your terminal",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Run in terminal:</div>
              <code className="text-sm">
                amp mcp add core-memory
                https://core.heysol.ai/api/v1/mcp?source=amp
              </code>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.AUGMENT_CODE]: {
    id: Provider.AUGMENT_CODE,
    name: "Augment Code",
    description: "Install CORE in Augment Code",
    docsUrl: "https://docs.heysol.ai/providers/augment-code",
    icon: "augment-code",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Go to ~/.augment/settings.json</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core-memory": {
      "type": "http",
      "url": "https://core.heysol.ai/api/v1/mcp?source=augment-code",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Generate and Add API Key from CORE Dashboard",
        component: (
          <p className="text-muted-foreground text-sm">
            Go to Settings → API Key → Generate new key → Name it "augment-code"
          </p>
        ),
      },
    ],
  },
  [Provider.ROO_CODE]: {
    id: Provider.ROO_CODE,
    name: "Roo Code",
    description: "Install CORE in Roo Code",
    docsUrl: "https://docs.heysol.ai/providers/roo-code",
    icon: "roo-code",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add to your Roo Code MCP configuration:</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core-memory": {
      "type": "streamable-http",
      "url": "https://core.heysol.ai/api/v1/mcp?source=Roo-Code",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.OPENCODE]: {
    id: Provider.OPENCODE,
    name: "Opencode",
    description: "Install CORE in Opencode",
    docsUrl: "https://docs.heysol.ai/providers/opencode",
    icon: "opencode",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add to your Opencode configuration:</div>
              <pre className="text-xs">
                {`"mcp": {
  "core-memory": {
    "type": "remote",
    "url": "https://core.heysol.ai/api/v1/mcp?source=Opencode",
    "headers": {
      "Authorization": "Bearer YOUR_API_KEY"
    },
    "enabled": true
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.QWEN_CODER]: {
    id: Provider.QWEN_CODER,
    name: "Qwen Coder",
    description: "Install CORE in Qwen Coder CLI",
    docsUrl: "https://docs.heysol.ai/providers/qwen-coder",
    icon: "qwen",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add to ~/.qwen/settings.json:</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core-memory": {
      "httpUrl": "https://core.heysol.ai/api/v1/mcp?source=Qwen",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY",
        "Accept": "application/json, text/event-stream"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.COPILOT_CLI]: {
    id: Provider.COPILOT_CLI,
    name: "Copilot CLI",
    description: "Install CORE in GitHub Copilot CLI",
    docsUrl: "https://docs.heysol.ai/providers/copilot-cli",
    icon: "github",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add to ~/.copilot/mcp-config.json:</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core": {
      "type": "http",
      "url": "https://core.heysol.ai/api/v1/mcp?source=Copilot-CLI",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.COPILOT_CODING_AGENT]: {
    id: Provider.COPILOT_CODING_AGENT,
    name: "Copilot Coding Agent",
    description: "Install CORE in GitHub Copilot Coding Agent",
    docsUrl: "https://docs.heysol.ai/providers/copilot-coding-agent",
    icon: "github",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>
                Add to Repository Settings → Copilot → Coding agent → MCP
                configuration:
              </div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core": {
      "type": "http",
      "url": "https://core.heysol.ai/api/v1/mcp?source=Copilot-Agent",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.WARP]: {
    id: Provider.WARP,
    name: "Warp",
    description: "Install CORE in Warp terminal",
    docsUrl: "https://docs.heysol.ai/providers/warp",
    icon: "warp",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add in Settings → AI → Manage MCP servers:</div>
              <pre className="text-xs">
                {`{
  "core": {
    "url": "https://core.heysol.ai/api/v1/mcp?source=Warp",
    "headers": {
      "Authorization": "Bearer YOUR_API_KEY"
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.ROVO_DEV]: {
    id: Provider.ROVO_DEV,
    name: "Rovo Dev CLI",
    description: "Install CORE in Atlassian Rovo Dev CLI",
    docsUrl: "https://docs.heysol.ai/providers/rovo-dev",
    icon: "rovo",
    installationSteps: [
      {
        title: "Edit mcp config",
        component: (
          <p className="text-muted-foreground text-sm">
            <pre className="text-xs">acli rovodev mcp</pre>
          </p>
        ),
      },
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add to your Rovo Dev MCP configuration:</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core-memory": {
      "url": "https://core.heysol.ai/api/v1/mcp?source=Rovo-Dev",
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.CLINE]: {
    id: Provider.CLINE,
    name: "Cline",
    description: "Install CORE in Cline",
    docsUrl: "https://docs.heysol.ai/providers/cline",
    icon: "cline",
    installationSteps: [
      {
        title: "Open Cline MCP Settings",
        component: (
          <p className="text-muted-foreground text-sm">
            Open Cline and click the hamburger menu icon (☰) to enter the MCP
            Servers section.
          </p>
        ),
      },
      {
        title: "Navigate to Remote Servers",
        component: (
          <p className="text-muted-foreground text-sm">
            Choose Remote Servers tab and click the Edit Configuration button.
          </p>
        ),
      },
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add to your Cline MCP configuration:</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core-memory": {
      "url": "https://core.heysol.ai/api/v1/mcp?source=Cline",
      "type": "streamableHttp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Generate and Add API Key from CORE Dashboard",
        component: (
          <p className="text-muted-foreground text-sm">
            Go to Settings → API Key → Generate new key → Name it "cline"
          </p>
        ),
      },
    ],
  },
  [Provider.KIRO]: {
    id: Provider.KIRO,
    name: "Kiro",
    description: "Install CORE in Kiro",
    docsUrl: "https://docs.heysol.ai/providers/kiro",
    icon: "kiro",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add in Kiro → MCP Servers:</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core-memory": {
      "url": "https://core.heysol.ai/api/v1/mcp?source=Kiro",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.TRAE]: {
    id: Provider.TRAE,
    name: "Trae",
    description: "Install CORE in Trae",
    docsUrl: "https://docs.heysol.ai/providers/trae",
    icon: "trae",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add to your Trae MCP configuration:</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core": {
      "url": "https://core.heysol.ai/api/v1/mcp?source=Trae"
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },

  [Provider.PERPLEXITY]: {
    id: Provider.PERPLEXITY,
    name: "Perplexity Desktop",
    description: "Install CORE in Perplexity Desktop",
    docsUrl: "https://docs.heysol.ai/providers/perplexity",
    icon: "perplexity",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>
                Add in Perplexity → Settings → Connectors → Add Connector →
                Advanced:
              </div>
              <pre className="text-xs">
                {`{
  "core-memory": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://core.heysol.ai/api/v1/mcp?source=perplexity"]
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Save Configuration",
        component: (
          <p className="text-muted-foreground text-sm">
            Click Save to apply the changes.
          </p>
        ),
      },
      {
        title: "Authenticate Core",
        component: (
          <p className="text-muted-foreground text-sm">
            Core will be available in your Perplexity sessions.
          </p>
        ),
      },
    ],
  },
  [Provider.QODO_GEN]: {
    id: Provider.QODO_GEN,
    name: "Qodo Gen",
    description: "Install CORE in Qodo Gen",
    docsUrl: "https://docs.heysol.ai/providers/qodo-gen",
    icon: "qodo",
    installationSteps: [
      {
        title: "Open Qodo Gen Chat Panel",
        component: (
          <p className="text-muted-foreground text-sm">
            Open Qodo Gen chat panel in VSCode or IntelliJ.
          </p>
        ),
      },
      {
        title: "Connect More Tools",
        component: (
          <p className="text-muted-foreground text-sm">
            Click Connect more tools, then click + Add new MCP.
          </p>
        ),
      },
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add the following configuration:</div>
              <pre className="text-xs">
                {`{
  "mcpServers": {
    "core-memory": {
      "url": "https://core.heysol.ai/api/v1/mcp?source=Qodo-Gen"
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.CRUSH]: {
    id: Provider.CRUSH,
    name: "Crush",
    description: "Install CORE in Crush terminal",
    docsUrl: "https://docs.heysol.ai/providers/crush",
    icon: "crush",
    installationSteps: [
      {
        title: "Add CORE MCP Server Configuration",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Add to your Crush configuration:</div>
              <pre className="text-xs">
                {`{
  "$schema": "https://charm.land/crush.json",
  "mcp": {
    "core": {
      "type": "http",
      "url": "https://core.heysol.ai/api/v1/mcp?source=Crush",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
              </pre>
            </div>
          </StepCodeBlock>
        ),
      },
    ],
  },
  [Provider.FACTORY]: {
    id: Provider.FACTORY,
    name: "Factory",
    description: "Install CORE in Factory droid",
    docsUrl: "https://docs.heysol.ai/providers/factory",
    icon: "factory",
    installationSteps: [
      {
        title: "Add CORE MCP Server via CLI",
        component: (
          <StepCodeBlock>
            <div className="space-y-2">
              <div>Run in terminal:</div>
              <code className="text-sm">
                droid mcp add core
                https://core.heysol.ai/api/v1/mcp?source=Factory --type http
                --header "Authorization: Bearer YOUR_API_KEY"
              </code>
            </div>
          </StepCodeBlock>
        ),
      },
      {
        title: "Verify Installation",
        component: (
          <p className="text-muted-foreground text-sm">
            Type /mcp within droid to manage servers and view available tools.
          </p>
        ),
      },
    ],
  },
};

export const SUGGESTED_INGESTION_PROMPTS = [
  "I'm a full-stack developer working on a React and Node.js application. I prefer TypeScript, functional programming patterns, and writing comprehensive tests.",
  "I'm working on a machine learning project using Python and PyTorch. I focus on computer vision and prefer Jupyter notebooks for exploration.",
  "I'm a DevOps engineer managing Kubernetes clusters. I work primarily with Terraform, Helm, and CI/CD pipelines using GitHub Actions.",
];

export const VERIFICATION_PROMPT = "Who am I? Tell me what you know about me.";
