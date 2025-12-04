<div align="right">
  <details>
    <summary >🌐 Language</summary>
    <div>
      <div align="center">
        <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=en">English</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=zh-CN">简体中文</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=zh-TW">繁體中文</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=ja">日本語</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=ko">한국어</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=hi">हिन्दी</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=th">ไทย</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=fr">Français</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=de">Deutsch</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=es">Español</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=it">Italiano</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=ru">Русский</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=pt">Português</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=nl">Nederlands</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=pl">Polski</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=ar">العربية</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=fa">فارسی</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=tr">Türkçe</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=vi">Tiếng Việt</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=id">Bahasa Indonesia</a>
      </div>
    </div>
  </details>
</div>

<div align="center">
  <a href="https://heysol.ai">
    <img src="https://github.com/user-attachments/assets/89066cdd-204b-46c2-8ad4-4935f5ca9edd" width="200px" alt="CORE logo" />
  </a>

### CORE: Your Personal Memory Layer for AI Apps

<p align="center">
    <a href="https://cursor.com/en/install-mcp?name=core-memory&config=eyJ1cmwiOiJodHRwczovL2NvcmUuaGV5c29sLmFpL2FwaS92MS9tY3A/c291cmNlPWN1cnNvciJ9Cg==">
        <img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" />
    </a>
</p>
<p align="center">
    <a href="https://heysol.ai">
        <img src="https://img.shields.io/badge/Website-heysol.ai-c15e50" alt="Website" />
    </a>
    <a href="https://docs.getcore.me">
        <img src="https://img.shields.io/badge/Docs-docs.getcore.me-green" alt="Docs" />
    </a>  
    <a href="https://discord.gg/YGUZcvDjUa">
        <img src="https://img.shields.io/badge/Discord-community-purple" alt="Discord" />
    </a>    
</p>
</div>

## ❌ Without CORE

LLMs lose context every time you switch tools or end conversation. You get:

- ❌ Re-explain your project context to each AI tool
- ❌ Lost conversations and decisions across ChatGPT, Claude, Cursor
- ❌ No memory of past discussions, preferences, or project history

## ✅ With CORE

CORE creates a unified memory layer across all your AI tools — placing persistent context directly into your LLM's awareness.

Add CORE to your workflow:

Add `search core memory` to your prompt in Cursor:

```txt
What were the architecture decisions we made for the
payment service last week?. Search core memory
```

Add `add to core memory` to your prompt in Cursor:

```txt
Set up authentication for my API service using JWT tokens.
Remember my preference for TypeScript strict mode. Add to core memory
```

CORE builds a temporal knowledge graph that remembers everything and makes it available across claude code, windsurf, cursor, claude and any MCP-compatible tool.

- 1️⃣ Connect CORE to your AI tools via MCP
- 2️⃣ Work naturally, your context gets captured automatically
- 3️⃣ Get persistent memory across all sessions and tools

No context loss, no re-explaining projects, no forgotten decisions.

## Why CORE?

1. **Persistent Memory Across Tools**: Your conversations in ChatGPT become available in Cursor. Decisions made in Claude are recalled in your next coding session. One unified memory graph.
2. **Temporal Knowledge Graph**: Not just storage — CORE tracks who said what, when, and why. Full provenance tracking means you can see how decisions evolved over time.
3. **88.24% Benchmark Accuracy**: State-of-the-art performance on the LoCoMo benchmark — outperforming competitors by 20+ percentage points in multi-hop and temporal reasoning.
4. **Your Data, Your Control**: Open-source, self-hostable, and designed for user ownership. Your memory belongs to you.

## 🛠️ Installation

### CLIs

<details>
<summary><b>Install in Claude Code CLI</b></summary>

1. Run this command in your terminal to connect CORE with Claude Code:

```sh
claude mcp add --transport http --scope user core-memory https://mcp.getcore.me/api/v1/mcp?source=Claude-Code
```

2. Type `/mcp` and open core-memory MCP for authentication

</details>

<details>
<summary><b>Install in Codex CLI</b></summary>

**Option 1 (Recommended):** Add to your `~/.codex/config.toml` file:

```toml
[features]
rmcp_client=true

[mcp_servers.memory]
url = "https://mcp.getcore.me/api/v1/mcp?source=codex"
```

Then run: `codex mcp memory login`

**Option 2 (If Option 1 doesn't work):** Add API key configuration:

```toml
[features]
rmcp_client=true

[mcp_servers.memory]
url = "https://mcp.getcore.me/api/v1/mcp?source=codex"
http_headers = { "Authorization" = "Bearer CORE_API_KEY" }
```

Get your API key from [app.getcore.me](https://app.getcore.me) → Settings → API Key, then run: `codex mcp memory login`

</details>

<details>
<summary><b>Install in Gemini CLI</b></summary>

See [Gemini CLI Configuration](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html) for details.

1.  Open the Gemini CLI settings file. The location is `~/.gemini/settings.json` (where `~` is your home directory).
2.  Add the following to the `mcpServers` object in your `settings.json` file:

```json
{
  "mcpServers": {
    "corememory": {
      "httpUrl": "https://mcp.getcore.me/api/v1/mcp?source=geminicli",
      "timeout": 5000
    }
  }
}
```

If the `mcpServers` object does not exist, create it.

</details>

<details>
<summary><b>Install in Copilot CLI</b></summary>

Add the following to your `~/.copilot/mcp-config.json` file:

```json
{
  "mcpServers": {
    "core": {
      "type": "http",
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Copilot-CLI",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

</details>

### IDEs

<details>
<summary><b>Install in Cursor</b></summary>

> Since Cursor 1.0, you can click the install button below for instant one-click installation.

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=core-memory&config=eyJ1cmwiOiJodHRwczovL2NvcmUuaGV5c29sLmFpL2FwaS92MS9tY3A/c291cmNlPWN1cnNvciJ9Cg==)

OR

1. Go to: `Settings` -> `Tools & Integrations` -> `Add Custom MCP`
2. Enter the below in `mcp.json` file:

```json
{
  "mcpServers": {
    "core-memory": {
      "url": "https://mcp.getcore.me/api/v1/mcp?source=cursor",
      "headers": {}
    }
  }
}
```

</details>

<details>
<summary><b>Install in VS Code</b></summary>

Enter the below in `mcp.json` file:

```json
{
  "servers": {
    "core-memory": {
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Vscode",
      "type": "http",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in VS Code Insiders</b></summary>

Add to your VS Code Insiders MCP config:

```json
{
  "mcp": {
    "servers": {
      "core-memory": {
        "type": "http",
        "url": "https://mcp.getcore.me/api/v1/mcp?source=VSCode-Insiders",
        "headers": {
          "Authorization": "Bearer YOUR_API_KEY"
        }
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Windsurf</b></summary>

Enter the below in `mcp_config.json` file:

```json
{
  "mcpServers": {
    "core-memory": {
      "serverUrl": "https://mcp.getcore.me/api/v1/mcp/source=windsurf",
      "headers": {
        "Authorization": "Bearer <YOUR_API_KEY>"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Zed</b></summary>

1. Go to `Settings` in Agent Panel -> `Add Custom Server`
2. Enter below code in configuration file and click on `Add server` button

```json
{
  "core-memory": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://mcp.getcore.me/api/v1/mcp?source=Zed"]
  }
}
```

</details>

### Coding Agents

<details>
<summary><b>Install in Amp</b></summary>

Run this command in your terminal:

```sh
amp mcp add core-memory https://mcp.getcore.me/api/v1/mcp?source=amp
```

</details>

<details>
<summary><b>Install in Augment Code</b></summary>

Add to your `~/.augment/settings.json` file:

```json
{
  "mcpServers": {
    "core-memory": {
      "type": "http",
      "url": "https://mcp.getcore.me/api/v1/mcp?source=augment-code",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Cline</b></summary>

1. Open Cline and click the hamburger menu icon (☰) to enter the MCP Servers section
2. Choose Remote Servers tab and click the Edit Configuration button
3. Add the following to your Cline MCP configuration:

```json
{
  "mcpServers": {
    "core-memory": {
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Cline",
      "type": "streamableHttp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Kilo Code</b></summary>

1. Go to `Settings` → `MCP Servers` → `Installed tab` → click `Edit Global MCP` to edit your configuration.
2. Add the following to your MCP config file:

```json
{
  "core-memory": {
    "type": "streamable-http",
    "url": "https://mcp.getcore.me/api/v1/mcp?source=Kilo-Code",
    "headers": {
      "Authorization": "Bearer your-token"
    }
  }
}
```

</details>

<details>
<summary><b>Install in Kiro</b></summary>

Add in Kiro → MCP Servers:

```json
{
  "mcpServers": {
    "core-memory": {
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Kiro",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Qwen Coder</b></summary>

See [Qwen Coder MCP Configuration](https://qwenlm.github.io/qwen-code-docs/en/tools/mcp-server/#how-to-set-up-your-mcp-server) for details.

Add to `~/.qwen/settings.json`:

```json
{
  "mcpServers": {
    "core-memory": {
      "httpUrl": "https://mcp.getcore.me/api/v1/mcp?source=Qwen",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY",
        "Accept": "application/json, text/event-stream"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Roo Code</b></summary>

Add to your Roo Code MCP configuration:

```json
{
  "mcpServers": {
    "core-memory": {
      "type": "streamable-http",
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Roo-Code",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Opencode</b></summary>

Add to your Opencode configuration:

```json
{
  "mcp": {
    "core-memory": {
      "type": "remote",
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Opencode",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      },
      "enabled": true
    }
  }
}
```

</details>

<details>
<summary><b>Install in Copilot Coding Agent</b></summary>

Add to Repository Settings → Copilot → Coding agent → MCP configuration:

```json
{
  "mcpServers": {
    "core": {
      "type": "http",
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Copilot-Agent",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Install in Qodo Gen</b></summary>

1. Open Qodo Gen chat panel in VSCode or IntelliJ
2. Click Connect more tools, then click + Add new MCP
3. Add the following configuration:

```json
{
  "mcpServers": {
    "core-memory": {
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Qodo-Gen"
    }
  }
}
```

</details>

### Terminals

<details>
<summary><b>Install in Warp</b></summary>

Add in Settings → AI → Manage MCP servers:

```json
{
  "core": {
    "url": "https://mcp.getcore.me/api/v1/mcp?source=Warp",
    "headers": {
      "Authorization": "Bearer YOUR_API_KEY"
    }
  }
}
```

</details>

<details>
<summary><b>Install in Crush</b></summary>

Add to your Crush configuration:

```json
{
  "$schema": "https://charm.land/crush.json",
  "mcp": {
    "core": {
      "type": "http",
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Crush",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

</details>

### Desktop Apps

<details>
<summary><b>Install in Claude Desktop</b></summary>

1. Copy CORE MCP URL:

```
https://mcp.getcore.me/api/v1/mcp?source=Claude
```

2. Navigate to Settings → Connectors → Click Add custom connector
3. Click on "Connect" and grant Claude permission to access CORE MCP

</details>

<details>
<summary><b>Install in ChatGPT</b></summary>

Connect ChatGPT to CORE's memory system via browser extension:

1. [Install Core Browser Extension](https://chromewebstore.google.com/detail/core-extension/cglndoindnhdbfcbijikibfjoholdjcc)
2. Generate API Key: Go to Settings → API Key → Generate new key → Name it "extension"
3. Add API Key in Core Extension and click Save

</details>

<details>
<summary><b>Install in Gemini</b></summary>

Connect Gemini to CORE's memory system via browser extension:

1. [Install Core Browser Extension](https://chromewebstore.google.com/detail/core-extension/cglndoindnhdbfcbijikibfjoholdjcc)
2. Generate API Key: Go to Settings → API Key → Generate new key → Name it "extension"
3. Add API Key in Core Extension and click Save

</details>

<details>
<summary><b>Install in Perplexity Desktop</b></summary>

1. Add in Perplexity → Settings → Connectors → Add Connector → Advanced:

```json
{
  "core-memory": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://mcp.getcore.me/api/v1/mcp?source=perplexity"]
  }
}
```

2. Click Save to apply the changes
3. Core will be available in your Perplexity sessions

</details>

### Development Tools

<details>
<summary><b>Install in Factory</b></summary>

Run in terminal:

```sh
droid mcp add core https://mcp.getcore.me/api/v1/mcp?source=Factory --type http --header "Authorization: Bearer YOUR_API_KEY"
```

Type /mcp within droid to manage servers and view available tools.

</details>

<details>
<summary><b>Install in Rovo Dev CLI</b></summary>

1. Edit mcp config:

```sh
acli rovodev mcp
```

2. Add to your Rovo Dev MCP configuration:

```json
{
  "mcpServers": {
    "core-memory": {
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Rovo-Dev"
    }
  }
}
```

</details>

<details>
<summary><b>Install in Trae</b></summary>

Add to your Trae MCP configuration:

```json
{
  "mcpServers": {
    "core": {
      "url": "https://mcp.getcore.me/api/v1/mcp?source=Trae"
    }
  }
}
```

</details>

## 🔨 Available Tools

CORE Memory MCP provides the following tools that LLMs can use:

- `memory_search`: Search relevant context from CORE Memory.
- `memory_ingest`: Add an episode in CORE Memory.
- `memory_about_user`: Fetches user persona from CORE Memory.
- `initialise_conversation_session`: Initialise conversation and assign session id to a conversation.
- `get_integrations`: Fetches what relevant integration should be used from the connected integrations.
- `get_integrations_actions`: Fetches what tool to be used from that integrations tools for the task.
- `execute_integrations_actions`: Execute the tool for that integration .

## 🚀 CORE Self-Hosting

Want to run CORE on your own infrastructure? Self-hosting gives you complete control over your data and deployment.

**Quick Deploy Options:**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/core?referralCode=LHvbIb&utm_medium=integration&utm_source=template&utm_campaign=generic)

**Prerequisites**:

- Docker (20.10.0+) and Docker Compose (2.20.0+) installed
- OpenAI API key

> **Note on Open-Source Models:** We tested OSS options like Ollama and GPT models, but their fact extraction and graph quality fell short. We're actively looking for options.

### Setup

1. Clone the repository:

```
git clone https://github.com/RedPlanetHQ/core.git
cd core
```

2. Configure environment variables in `core/.env`:

```
OPENAI_API_KEY=your_openai_api_key
```

3. Start the service

```
docker-compose up -d
```

Once deployed, you can configure your AI providers (OpenAI, Anthropic) and start building your memory graph.

👉 [View complete self-hosting guide](https://docs.getcore.me/self-hosting/docker)

Note: We tried open-source models like Ollama or GPT OSS but facts generation were not good, we are still figuring out how to improve on that and then will also support OSS models.

## 🚀 CORE Cloud

**Build your unified memory graph in 5 minutes:**

Don't want to manage infrastructure? CORE Cloud lets you build your personal memory system instantly - no setup, no servers, just memory that works.

1. **Sign Up** at [app.getcore.me](https://app.getcore.me) and create your account
2. **Visualize your memory graph** and see how CORE automatically forms connections between facts
3. **Test it out** - ask "What do you know about me?" in conversation section
4. Connect to your tools:
   - [Claude](https://docs.getcore.me/providers/claude) & [Cursor](https://docs.getcore.me/providers/cursor) - coding with context
   - [CLaude Code CLI](https://docs.getcore.me/providers/claude-code) & [Codex CLI](https://docs.getcore.me/providers/codex) - terminal-based coding with memory
   - [Add Browser Extension](https://docs.getcore.me/providers/browser-extension) - bring your memory to any website
   - [Linear](https://docs.getcore.me/integrations/linear), [Github](https://docs.getcore.me/integrations/github) - add project context automatically

## 🔥 Research Highlights

CORE memory achieves **88.24%** average accuracy in Locomo dataset across all reasoning tasks, significantly outperforming other memory providers. Check out this [blog](https://blog.heysol.ai/core-build-memory-knowledge-graph-for-individuals-and-achieved-sota-on-locomo-benchmark/) for more info.

<img width="6048" height="3428" alt="benchmark" src="https://github.com/user-attachments/assets/2e5fdac5-02ed-4d00-9312-c21d09974e1f" />
(1) Single-hop questions require answers based on a single session; (2) Multi-hop questions require synthesizing information from multiple different sessions; (3) Open-domain knowledge questions can be answered by integrating a speaker’s provided information with external knowledge such as commonsense or world facts; (4) Temporal reasoning questions can be answered through temporal reasoning and capturing time-related data cues within the conversation;

## How CORE create memory

<img width="12885" height="3048" alt="memory-ingest-diagram" src="https://github.com/user-attachments/assets/c51679de-8260-4bee-bebf-aff32c6b8e13" />

CORE’s ingestion pipeline has four phases designed to capture evolving context:

1. **Normalization**: Links new information to recent context, breaks long documents into coherent chunks while keeping cross-references, and standardizes terms so by the time CORE extracts knowledge, it’s working with clean, contextualized input instead of messy text.
2. **Extraction**: Pulls meaning from normalized text by identifying entities (people, tools, projects, concepts), turning them into statements with context, source, and time, and mapping relationships. For example, “We wrote CORE in Next.js” becomes: Entities (Core, Next.js), Statement (CORE was developed using Next.js), and Relationship (was developed using).
3. **Resolution**: Detects contradictions, tracks how preferences evolve, and preserves multiple perspectives with provenance instead of overwriting them so memory reflects your full journey, not just the latest snapshot.
4. **Graph Integration**: Connects entities, statements, and episodes into a temporal knowledge graph that links facts to their context and history, turning isolated data into a living web of knowledge agents can actually use.

The Result: Instead of a flat database, CORE gives you a memory that grows and changes with you - preserving context, evolution, and ownership so agents can actually use it.

![memory-ingest-eg](https://github.com/user-attachments/assets/1d0a8007-153a-4842-9586-f6f4de43e647)

## How CORE recalls from memory

<img width="10610" height="3454" alt="memory-search-diagram" src="https://github.com/user-attachments/assets/3541893e-f7c9-42b9-8fad-6dabf138dbeb" />

When you ask CORE a question, it doesn’t just look up text - it digs into your whole knowledge graph to find the most useful answers.

1. **Search**: CORE looks through memory from multiple angles at once - keyword search for exact matches, semantic search for related ideas even if phrased differently, and graph traversal to follow links between connected concepts.
2. **Re-Rank**: The retrieved results are reordered to highlight the most relevant and diverse ones, ensuring you don’t just see obvious matches but also deeper connections.
3. **Filtering**: CORE applies smart filters based on time, reliability, and relationship strength, so only the most meaningful knowledge surfaces.
4. **Output**: You get back both facts (clear statements) and episodes (the original context they came from), so recall is always grounded in context, time, and story.

The result: CORE doesn’t just recall facts - it recalls them in the right context, time, and story, so agents can respond the way you would remember.

## 🧩 Key Features

### 🧠 **Unified, Portable Memory**:

Add and recall your memory across **Cursor, Windsurf, Claude Desktop, Claude Code, Gemini CLI, AWS's Kiro, VS Code, and Roo Code** via MCP

![core-claude](https://github.com/user-attachments/assets/56c98288-ee87-4cd0-8b02-860aca1c7f9a)

### 🕸️ **Temporal + Reified Knowledge Graph**:

Remember the story behind every fact—track who said what, when, and why with rich relationships and full provenance, not just flat storage

![core-memory-graph](https://github.com/user-attachments/assets/5d1ee659-d519-4624-85d1-e0497cbdd60a)

### 🌐 **Browser Extension**:

Save conversations and content from ChatGPT, Grok, Gemini, Twitter, YouTube, blog posts, and any webpage directly into your CORE memory.

**How to Use Extension**

1. [Download the Extension](https://chromewebstore.google.com/detail/core-extension/cglndoindnhdbfcbijikibfjoholdjcc) from the Chrome Web Store.
2. Login to [CORE dashboard](https://app.getcore.me)
   - Navigate to Settings (bottom left)
   - Go to API Key → Generate new key → Name it “extension.”
3. Open the extension, paste your API key, and save.

https://github.com/user-attachments/assets/6e629834-1b9d-4fe6-ae58-a9068986036a

### 💬 **Chat with Memory**:

Ask questions like "What are my writing preferences?" with instant insights from your connected knowledge

![chat-with-memory](https://github.com/user-attachments/assets/d798802f-bd51-4daf-b2b5-46de7d206f66)

### ⚡ **Auto-Sync from Apps**:

Automatically capture relevant context from Linear, Slack, Notion, GitHub and other connected apps into your CORE memory

📖 **[View All Integrations](./integrations/README.md)** - Complete list of supported services and their features

![core-slack](https://github.com/user-attachments/assets/d5fefe38-221e-4076-8a44-8ed673960f03)

### 🔗 **MCP Integration Hub**:

Connect Linear, Slack, GitHub, Notion once to CORE—then use all their tools in Claude, Cursor, or any MCP client with a single URL

![core-linear-claude](https://github.com/user-attachments/assets/7d59d92b-8c56-4745-a7ab-9a3c0341aa32)

## Documentation

Explore our documentation to get the most out of CORE

- [Basic Concepts](https://docs.getcore.me/concepts/memory_graph)
- [Self Hosting](https://docs.getcore.me/self-hosting/overview)
- [Connect Core MCP with Claude](https://docs.getcore.me/providers/claude)
- [Connect Core MCP with Cursor](https://docs.getcore.me/providers/cursor)
- [Connect Core MCP with Claude Code](https://docs.getcore.me/providers/claude-code)
- [Connect Core MCP with Codex](https://docs.getcore.me/providers/codex)

- [Basic Concepts](https://docs.getcore.me/overview)
- [API Reference](https://docs.getcore.me/api-reference/get-user-profile)

## 🔒 Security

CORE takes security seriously. We implement industry-standard security practices to protect your data:

- **Data Encryption**: All data in transit (TLS 1.3) and at rest (AES-256)
- **Authentication**: OAuth 2.0 and magic link authentication
- **Access Control**: Workspace-based isolation and role-based permissions
- **Vulnerability Reporting**: Please report security issues to harshith@poozle.dev

For detailed security information, see our [Security Policy](SECURITY.md).

## 🧑‍💻 Support

Have questions or feedback? We're here to help:

- Discord: [Join core-support channel](https://discord.gg/YGUZcvDjUa)
- Documentation: [docs.getcore.me](https://docs.getcore.me)
- Email: manik@poozle.dev

## Usage Guidelines

**Store:**

- Conversation history
- User preferences
- Task context
- Reference materials

**Don't Store:**

- Sensitive data (PII)
- Credentials
- System logs
- Temporary data

## 👥 Contributors

<a href="https://github.com/RedPlanetHQ/core/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=RedPlanetHQ/core" />
</a>
