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
  <a href="https://getcore.me">
    <img width="200px" alt="CORE logo" src="https://github.com/user-attachments/assets/bd4e5e79-05b8-4d40-9aff-f1cf9e5d70de" />
  </a>

# AI Operating System to build your own Jarvis.

An always-on AI that watches your screen, your apps, and your AI tools. Speaks back to you through your AirPods in a voice you chose. Remembers everything across them. Acts on your behalf when you let it, asks first when you do not.

Name it. Shape it. Connect it to everything you use. Reach it however you work. Open source, self-hosted, yours forever.

<p align="center">
    <a href="https://getcore.me">
        <img src="https://img.shields.io/badge/Website-getcore.me-c15e50?style=for-the-badge&logo=safari&logoColor=white" alt="Website" />
    </a>
    <a href="https://docs.getcore.me">
        <img src="https://img.shields.io/badge/Docs-docs.getcore.me-22C55E?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Docs" />
    </a>
    <a href="https://discord.gg/YGUZcvDjUa">
        <img src="https://img.shields.io/badge/Discord-community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" />
    </a>
    <a href="https://github.com/RedPlanetHQ/core/blob/main/LICENSE">
        <img src="https://img.shields.io/badge/License-AGPL%203.0-blue?style=for-the-badge" alt="License: AGPL 3.0" />
    </a>
    <a href="https://github.com/RedPlanetHQ/core/stargazers">
        <img src="https://img.shields.io/github/stars/RedPlanetHQ/core?style=for-the-badge&color=gold&logo=github" alt="GitHub Stars" />
    </a>
</p>
</div>

---

## See it work

Watch CORE take a plain-text task, gather context from GitHub and memory, plan the work, run a Claude Code session, and open a PR:

[![CORE Demo](https://img.youtube.com/vi/7y_kt_UTYQs/maxresdefault.jpg)](https://www.youtube.com/watch?v=7y_kt_UTYQs)

---

## The Jarvis loop

CORE is not a single agent. It is the operating system that runs the loop around your agents.

```
   ┌─────────────────────────────────────────────────────────────────┐
   │                                                                 │
   │   Watch  →  Memory  →  Skills  →  Toolkit  →  Gateway  →  You   │
   │                                                                 │
   └─────────────────────────────────────────────────────────────────┘
```

1. **Watch.** Webhooks from connected apps, polling where webhooks do not exist, macOS accessibility APIs sampling your screen every few seconds, and your conversations inside Claude Code, Codex, and Cursor. CORE sees what is happening across your tools and your life.

2. **Memory.** Everything CORE sees flows into a temporal knowledge graph. Preferences, decisions, project context, who said what when. Every future task starts with this loaded.

3. **Skills and watch rules.** Your custom instructions decide what CORE does when something happens. "If an investor emails, draft a reply and ping me on Slack for review." "If Sentry fires, investigate first, then propose a fix." 100+ built-in, or write your own.

4. **Toolkit.** 1000+ actions across 50+ apps through one MCP endpoint. Gmail, Calendar, GitHub, Linear, Slack, Notion, Sentry, Todoist, and more.

5. **Gateway.** Hard work goes to specialists. CORE does not write code itself, it spawns a Claude Code or Codex session. It does not drive a browser itself, it spawns a browser agent. It does not run terminal commands itself, it shells out. CORE orchestrates.

6. **Surfaces.** Results come back where you are. Voice in your AirPods, a Slack ping, a WhatsApp message, a Telegram reply, an email, or a row on your scratchpad.

That is the loop. Every section below is just one part of it expanded.

---

## Two modes of working with it

**Real-time voice and chat.** Press `Ctrl+Option` and talk. CORE listens, runs the request, and answers back through your AirPods in the ElevenLabs voice you configured. Conversational, interruptible, fast. Open the chat dashboard for the same back-and-forth in text. "How does my calendar look today?" Hear the answer in seconds.

**Async tasks.** Write `[ ] Book my flights to SF for the YC dinner` in your scratchpad, send a WhatsApp message, or fire a webhook from anywhere. CORE picks it up within three minutes, gathers context from memory and connected apps, drafts a plan, asks for approval if you required it, runs the work in the background, and pings you back on your preferred channel when it is done or stuck.

Both modes share the same memory, skills, and toolkit. One AI, two flavors of attention.

---

## What "always watching" actually means

- **Webhooks** on connected apps (Gmail, GitHub, Sentry, Linear, Slack, and more) for instant reaction.
- **Polling** for integrations without webhooks, so coverage does not drop.
- **Screen capture via macOS accessibility APIs**, sampling text content every few seconds so CORE remembers what you were working on and can recall it later. Toggle per app, or off entirely.
- **Cross-agent context.** Install the CORE plugin inside Claude Code, Codex, or Cursor and CORE remembers those conversations too. The next task already knows what your last Claude Code session decided.

You decide what CORE watches and what it ignores, per app, per surface, per rule. Self-host the full stack if you want the data to never leave your machine.

---

## CORE in action

### Voice in, voice out.

*Press Ctrl+Option, speak:* "What is on my calendar tomorrow, and is anything in conflict with my flight?"

CORE checks Google Calendar, cross-references your travel plans from memory, and speaks the answer back through your AirPods.

### Voice triggers a coding session in the background.

*Press Ctrl+Option, speak:* "Fix the race condition in the checkout flow from issue #312."

CORE drafts a plan, spawns a Claude Code session on your gateway, runs it on Railway, and pings you on Slack when the PR is ready. You were never at your desk.

### Watch rules turn inbound email into a draft.

*A new email from an investor lands.* Your watch rule says: draft a reply in my tone using project context from memory, send the draft to Slack for review, never send the actual email without my approval. CORE wakes, drafts, posts to Slack, waits.

### Summarize and follow up, no code required.

*WhatsApp from the airport:* "Summarize my last three customer calls and draft follow-ups."

CORE pulls transcripts from Fireflies, reads them, drafts a personalized follow-up email per customer using your tone from memory, and asks you to approve each one.

### Build a tracker from scratch.

*Voice:* "Build me a talent acquisition tracker by reading the shared Google Calendars of my hiring managers."

CORE asks a clarifying question or two by voice, then spawns a Claude Code session through the gateway. Comes back with a working tracker and a dashboard widget you can view inside CORE.

### Investigate alerts before they become incidents.

*Sentry fires at 2am.* CORE investigates, pulls related traces and prior incidents from memory, proposes a fix, and pings you on Slack: "Issue #847, fix proposed, awaiting your review." You approve from your phone.

### A brief that already knows your week.

*Recurring task, every morning at 8am.* CORE pulls from email, GitHub, Linear, and Slack, surfaces what actually needs attention, skips what does not, and turns follow-ups into tasks automatically.

---

## How it becomes yours

Day 1, CORE knows nothing about you. By day 30, it remembers your investors, your projects, your tone, your preferences on testing, your favorite channels, and who you usually email after a sales call. By day 90, it acts like a person who has been with you for a year.

Memory grows from three sources: your direct conversations with CORE, your sessions inside Claude Code, Codex, and Cursor via the plugin, and ambient observation from connected apps and screen capture.

You shape the agent further:

- **Name and personality.** Pick from five built-ins (TARS's dry efficiency, Alfred's loyal formality, Hudson's warm practicality, and more) or write your own. Personality is not just text tone, it shapes how CORE plans, prioritizes, and pushes back.
- **Voice.** Configure any ElevenLabs voice for spoken interactions. From then on, CORE sounds like the AI you want.
- **Skills and watch rules.** Custom instructions that fire in context. "Always check Linear before estimating effort." "Never send an email without my review." "Post a Slack summary when a task completes."

CORE at t=10 is a generic assistant. CORE at t=100 is yours.

---

## Why this is an OS, not just another agent

An operating system does not compute your math. It schedules processes, manages memory, and routes work to the right binary. CORE works the same way:

- **Coding work** goes to Claude Code or Codex via the gateway.
- **Browser work** goes to a headless browser agent.
- **Terminal work** runs as a shell process on your machine, Docker, or Railway.
- **App actions** go through MCP connectors.
- **Long-running watchers** sit as background subscribers.
- **Memory, skills, and personality** are the shared substrate every process reads from.

CORE is the kernel. You bring the apps (skills, connectors, agents). The base prompt, the loop, the surfaces, and the memory are tuned for one job: personal assistant, chief of staff, butler. It is not a generic agent framework like LangChain. It is shaped to operate as you. That is why we call it an OS for building your own Jarvis.

---

## What is inside CORE

| | |
|---|---|
| **Memory** | Temporal knowledge graph across every tool and conversation. Preferences, decisions, goals, and directives, so every task starts with context loaded. |
| **Tasks** | One-shot or recurring work units with your spec, CORE's plan, live state, and a dedicated chat thread. Each task can spawn coding, browser, or terminal sessions. |
| **Skills and watch rules** | Reusable instructions that fire automatically based on context. 100+ built-in, or write your own. |
| **Toolkit** | 1000+ actions across 50+ apps through one MCP endpoint, plus webhook triggers for proactive automation. |
| **Gateway** | Runs Claude Code, Codex, browser agents, and terminal commands on your machine, in Docker, or on Railway, so CORE keeps working when your laptop is closed. |
| **Voice** | Whisper in, ElevenLabs out. Push to talk via Ctrl+Option. Configurable voice and personality. |
| **Widgets** | Dashboards generated for tasks. Visualize outputs, track recurring work, manage what CORE built for you. |
| **Surfaces** | Voice, scratchpad, chat, WhatsApp, Slack, Telegram, email, API. Same memory and context behind all of them. |
| **Model agnostic** | Bring your own provider: Anthropic, OpenAI, or open-weight models. Self-host the full stack for full isolation. |

---

## How CORE compares

| | CORE | OpenClaw | Hermes Agent | Devin / Copilot |
|---|:---:|:---:|:---:|:---:|
| Multiple interfaces (voice, scratchpad, chat, messaging) | ✅ | Partial | ❌ | ❌ |
| Bidirectional voice (speak in, speak back) | ✅ | ❌ | ❌ | ❌ |
| Persistent memory across tasks | ✅ | ❌ | ✅ | ❌ |
| Cross-agent memory (Claude Code, Codex, Cursor) | ✅ | ❌ | ❌ | ❌ |
| Delegates to coding agents (Claude Code, Codex) | ✅ | ❌ | ❌ | ✅ |
| Structured task planning with human approval | ✅ | ❌ | ❌ | Partial |
| Custom name, personality, and voice | ✅ | ❌ | ❌ | ❌ |
| 50+ app connectors | ✅ | Partial | Partial | ❌ |
| Terminal and browser access via gateway | ✅ | ✅ | ✅ | ✅ |
| Watch rules and proactive automation | ✅ | ❌ | Partial | ❌ |
| Human-in-loop by default | ✅ | ❌ | ❌ | ❌ |
| Open source and self-hostable | ✅ | ✅ | ✅ | ❌ |

---

## Quickstart

Open source and self-hosted. Your data stays in your infrastructure.

**Choose your path:**

| I want to... | How |
|---|---|
| Try it on my machine | Run the one-step install below (requires Docker) |
| Deploy on a server or VPS | One-click Railway deploy |
| Use the Mac app | [Join the waitlist](https://www.getcore.me/) |

**Install and start CORE:**

```bash
npm install -g @redplanethq/corebrain && corebrain setup
```

The setup wizard asks for an install directory, AI provider, API key, and chat model. It generates secrets, starts the stack, and opens `http://localhost:3033`.

Most local installs take a few minutes once Docker is running.

**Or deploy on Railway:**

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/core)

**Connect a gateway** so CORE can run coding agents, drive your browser, and access local folders:

```bash
corebrain login
corebrain gateway setup
```

**Requirements:** Docker 20.10+, Docker Compose 2.20+, 4 vCPU / 8GB RAM

[Full self-hosting guide](https://docs.getcore.me/self-hosting/setup)

**Your first task (2 minutes after setup):**

1. Open the **Scratchpad** (your daily page at `http://localhost:3033`)
2. Type `[ ] Summarize my open GitHub issues` or any task you would normally do yourself
3. CORE picks it up within 3 minutes, gathers context from connected apps, and drafts a plan
4. Approve the plan and CORE runs it and brings back the result

[Connect your first app](https://docs.getcore.me/connectors)

---

## Docs

- [**Memory**](https://docs.getcore.me/memory/overview): Temporal knowledge graph, fact classification, intent-driven retrieval
- [**Scratchpad**](https://docs.getcore.me/concepts/scratchpad): The daily surface where tasks and ideas start
- [**Tasks**](https://docs.getcore.me/concepts/tasks): Plans, state, recurring work, and task-scoped context
- [**Toolkit**](https://docs.getcore.me/concepts/toolkit): 1000+ actions across 50+ apps via MCP
- [**CORE Agent**](https://docs.getcore.me/concepts/meta-agent): Triggers, memory, tools, and execution
- [**Gateway**](https://docs.getcore.me/access-core/overview): WhatsApp, Slack, Telegram, email, web, and API access
- [**Skills**](https://docs.getcore.me/skills/overview): Reusable instructions for repeatable workflows
- [**Self-hosting**](https://docs.getcore.me/self-hosting/setup): Full deployment guide
- [**Changelog**](https://docs.getcore.me/opensource/changelog): What has shipped

---

## Benchmark

CORE achieves **88.24%** average accuracy on the [LoCoMo benchmark](https://github.com/RedPlanetHQ/core-benchmark) across single-hop, multi-hop, open-domain, and temporal reasoning. See the benchmark repo for full results and baseline comparisons.

---

## Security

- CASA Tier 2 Certified
- TLS 1.3 in transit
- AES-256 at rest
- Your data is never used for model training
- Self-host for full isolation
- [Security policy](SECURITY.md)
- Vulnerabilities: harshith@poozle.dev

---

## Community

We are building CORE in public.

We share the roadmap and architectural decisions openly because the hardest problems in building a personal OS are best solved with the people using it. Star the repo, self-host it, share what you build, and open issues for what is broken or missing.

- [Discord](https://discord.gg/YGUZcvDjUa): questions, ideas, show-and-tell
- [Contributing docs](https://docs.getcore.me/opensource/contributing): how to contribute to CORE
- [`good-first-issue`](https://github.com/RedPlanetHQ/core/labels/good-first-issue): start here

<a href="https://github.com/RedPlanetHQ/core/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=RedPlanetHQ/core" />
</a>

---

<div align="center">

**Self-host your personal AI OS.**

[Star this repo](https://github.com/RedPlanetHQ/core) · [Read the docs](https://docs.getcore.me) · [Join Discord](https://discord.gg/YGUZcvDjUa)

</div>
