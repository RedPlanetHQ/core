<a href="https://www.youtube.com/watch?v=7y_kt_UTYQs" target="_blank" rel="noopener noreferrer">
  <img width="1339" height="607" alt="core-github-hero" src="docs/images/readme/hero-video.png" />
</a>

<h5 align="center">

<h1 align="center">CORE</h1>
<p align="center">Your personal AI OS — always on, always watching, always ready to act.</p>

<p align="center" style="display: flex; justify-content: center; gap: 20px; align-items: center;">
  <a href="https://trendshift.io/repositories/13609" target="blank">
    <img src="https://trendshift.io/api/badge/repositories/13609" alt="RedPlanetHQ/core | Trendshift" width="250" height="55"/>
  </a>
</p>

<p align="center">
  <a href="https://getcore.me" target="_blank" rel="noopener">
    <img alt="Website" src="https://img.shields.io/badge/Website-10b981?labelColor=10b981&logo=window&logoColor=white">
  </a>
  <a href="https://docs.getcore.me" target="_blank" rel="noopener">
    <img alt="Docs" src="https://img.shields.io/badge/Docs-22C55E?logo=readthedocs&logoColor=white&labelColor=22C55E">
  </a>
  <a href="https://discord.gg/YGUZcvDjUa" target="_blank" rel="noopener">
    <img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white&labelColor=5865F2">
  </a>
  <a href="https://x.com/intent/user?screen_name=heysourcecore" target="_blank" rel="noopener">
    <img alt="Twitter" src="https://img.shields.io/twitter/follow/heysourcecore?style=social">
  </a>
  <a href="https://github.com/RedPlanetHQ/core/blob/main/LICENSE" target="_blank" rel="noopener">
    <img alt="License" src="https://img.shields.io/badge/License-AGPL%203.0-blue">
  </a>
</p>

</h5>

CORE watches your work across every tool you use, builds a temporal knowledge graph of what happened and why, and acts on it — from voice, scratchpad, chat, or a WhatsApp message. It can reply to email, file PRs, drive a browser, run terminal commands, and spawn Claude Code or Codex sessions with your full context loaded.


Install with one command: `npm install -g @redplanethq/corebrain && corebrain setup`

<p align="center">
<a href="https://www.youtube.com/watch?v=7y_kt_UTYQs">
<img width="800" height="450" alt="CORE end-to-end demo" src="docs/images/readme/demo.gif" />
</a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=7y_kt_UTYQs"> Demo — voice to PR </a> · <a href="https://docs.getcore.me/memory/overview"> Memory graph walkthrough</a>
</p>


⭐ If you find CORE useful, please star the repo. It helps more people find it.

---
## Overview

<table>
<tr>
<td width="40%" valign="middle">
<h3>Memory</h3>
CORE builds a temporal knowledge graph across every tool and conversation — preferences, decisions, goals, and directives — so every task starts with full context loaded, not reconstructed from scratch.
</td>
<td width="60%">
<img width="1502" height="939" alt="Memory graph screenshot" src="docs/images/readme/memory.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Scratchpad</h3>
Your daily page. Write <code>[ ] Fix the auth bug from issue #47</code> and CORE picks it up within 3 minutes, gathers context from your repo and memory, and drafts a plan for your approval.
</td>
<td width="60%">
<img width="1512" height="948" alt="Scratchpad screenshot" src="docs/images/readme/scratchpad.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Tasks</h3>
One-shot or recurring work units with your spec, CORE's plan, live state, and a dedicated chat thread. Each task can spawn coding, browser, or terminal sessions and comes back with a diff, a summary, or one tight question.
</td>
<td width="60%">
<img width="1512" height="951" alt="Tasks screenshot" src="docs/images/readme/tasks.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Voice</h3>
Press Ctrl+Option on Mac and say what needs doing. CORE runs it in the background without breaking your flow — full memory and context available on every request.
</td>
<td width="60%">
<img width="1512" height="948" alt="Voice screenshot" src="docs/images/readme/voice.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Messaging</h3>
Send a task from WhatsApp, Slack, or Telegram. CORE picks it up with the same memory and context it would have at your desk — kick off a coding session from the airport, from your phone, from bed.
</td>
<td width="60%">
<img width="1512" height="947" alt="Messaging screenshot" src="docs/images/readme/messaging.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Code Mode</h3>
Delegate to Claude Code or Codex directly from any surface. CORE drives the session with the right issue, related commits, and memory context — you come back to a PR.
</td>
<td width="60%">
<img width="1512" height="949" alt="Code mode screenshot" src="docs/images/readme/code-mode.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Skills</h3>
Reusable instructions that fire automatically based on context — "always pull related Linear issues before planning a fix," "run tests before opening a PR," "post a Slack summary when a task completes." 100+ built-in, or write your own.
</td>
<td width="60%">
<img width="1512" height="949" alt="Skills screenshot" src="docs/images/readme/skills.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Connectors</h3>
50+ apps through one MCP endpoint, plus webhook triggers for proactive automation. GitHub, Linear, Jira, Slack, Gmail, Calendar, Sentry, Notion, Todoist, and more.
</td>
<td width="60%">
<img width="1512" height="948" alt="Connectors screenshot" src="docs/images/readme/connectors.png" />
</td>
</tr>

</table>

---

## Installation

**Install and start CORE (requires Docker):**

```bash
npm install -g @redplanethq/corebrain && corebrain setup
```

The setup wizard asks for an install directory, AI provider, API key, and chat model. It generates secrets, starts the stack, and opens `http://localhost:3033`.

**All release files:** https://github.com/RedPlanetHQ/core/releases/latest

### Deploy on Railway
One-click deploy to a server or VPS:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/core)

### Gateway
Connect a gateway so CORE can run coding agents, drive your browser, and access local folders:

```bash
corebrain login
corebrain gateway setup
```

### Google setup
To connect Google services (Gmail, Calendar, and Drive), follow the [Google setup guide](https://docs.getcore.me/connectors/google).

### Voice input
To enable voice input and voice notes (optional), add a Deepgram API key in `~/.corebrain/config/deepgram.json`.

### Voice output
To enable voice output (optional), add an ElevenLabs API key in `~/.corebrain/config/elevenlabs.json`.

### External tools
To enable external tools (optional), you can add any MCP server or use Composio tools by adding an API key in `~/.corebrain/config/composio.json`.

All API key files use the same format:
```
{
  "apiKey": "<key>"
}
```

**Requirements:** Docker 20.10+, Docker Compose 2.20+, 4 vCPU / 8GB RAM. [Full self-hosting guide](https://docs.getcore.me/self-hosting/setup).


## How it's different

Most AI tools wait to be asked, then reconstruct context on demand by searching transcripts or documents.

CORE maintains **long-lived memory** instead and acts on it proactively:
- context accumulates across every tool and conversation
- relationships are explicit and inspectable in a temporal knowledge graph
- CORE notices events on its own — new email, GitHub issue, Sentry alert — and either handles them or surfaces them for your judgment
- autonomy is yours to set per task, per app, per action

The result is an AI that gets more useful over time, not one that starts cold every session.

## Bring your own model

CORE works with the model setup you prefer:
- **Hosted models** — Anthropic, OpenAI, or any provider (bring your own API key)
- **Open-weight models** via your own inference stack
- Swap models anytime — your data stays in your self-hosted instance

## Extend CORE with tools (MCP)

CORE can connect to external tools and services via **Model Context Protocol (MCP)**.
That means you can plug in (for example) search, databases, CRMs, support tools, and automations — or your own internal tools.

Examples: GitHub, Linear, Jira, Slack, Gmail, Calendar, Sentry, Notion, Todoist, Composio, and more. 1000+ actions across 50+ apps.

## Local-first and self-hosted by design

- Self-host the full stack for full isolation
- Your data stays in your infrastructure — never used for model training
- CASA Tier 2 Certified, TLS 1.3 in transit, AES-256 at rest
- [Security policy](SECURITY.md) · Vulnerabilities: harshith@poozle.dev

---
<div align="center">

[Website](https://getcore.me) · [Docs](https://docs.getcore.me) · [Discord](https://discord.gg/YGUZcvDjUa) · [Twitter](https://x.com/intent/user?screen_name=heysourcecore)

</div>
