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

# Your personal AI OS.

**Watches your work. Remembers what matters. Acts across your tools and agents. Open source, self-hosted, yours forever.**

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
</p>
</div>

---

## What we believe

- Chat is an interface. Not an OS.
- Intelligence without memory is trivia.
- Your AI should know you across every tool, not just the current tab.
- Work should move from intent to action without you becoming the glue.
- Automation without accountability is chaos.
- Open source is not a licensing decision. It is a design commitment.

---

## Roadmap

We are building in phases. Here is where we are.

| | |
|---|---|
| **Phase 0** (done) | Contract layer. Schemas, task state, plans, and auditability. No silent action without a task. |
| **Phase 1** (done) | Operating layer. Reliable integrations, tasks, and triage loops. |
| **Phase 2** (now) | Ambient layer. Passive context capture across AI conversations, connected apps, and on Mac, any app you explicitly grant access to. |
| **Phase 3** (future) | Personal model layer. A fine-tuned model trained on your memory and context. Privacy-first, runs locally. No timeline yet. |
| **Phase 4** | New surfaces. Wearables, glanceable presence, edge devices. |
| **Phase 5** | Ecosystem. Linux-style packages and plugins. Standard interfaces for memory, tools, and policy. |

---

## Quickstart

Open source and self-hosted. Your data stays in your infrastructure.

**Install and start CORE:**

```bash
npm install -g @redplanethq/corebrain && corebrain setup
```

The setup wizard asks for an install directory, AI provider, API key, and chat model. It generates secrets, starts the stack, and opens `http://localhost:3033`.

Most local installs take a few minutes once Docker is running.

**Or deploy on Railway:**

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/core)

**Connect a gateway** so CORE can drive your browser, run coding agents, and access local folders:

```bash
corebrain login
corebrain gateway setup
```

**Requirements:** Docker 20.10+, Docker Compose 2.20+, 4 vCPU / 8GB RAM

[Full self-hosting guide](https://docs.getcore.me/self-hosting/setup)

> Want the Mac app? Join the waitlist at [getcore.me](https://www.getcore.me/).

---

## See it work

Watch CORE handle two coding tasks end to end:

[![CORE Demo](https://img.youtube.com/vi/7y_kt_UTYQs/maxresdefault.jpg)](https://www.youtube.com/watch?v=7y_kt_UTYQs)

---

## What CORE is

CORE is the open-source operating layer for AI-native work.

You write what needs doing in a scratchpad. CORE picks up the task, loads context from memory and connected apps, drafts a plan, runs the right agent through the gateway, handles blockers where it can, and comes back when human judgment is needed.

It is not a chatbot you keep prompting. It is the layer that remembers, coordinates, acts, and escalates.

### The architecture

| | |
|---|---|
| **Watches** | Context from your AI conversations via MCP, 50+ connected apps, and on Mac, any app you explicitly grant access to. |
| **Remembers** | A knowledge graph that tracks not just what you said, but what you decided, when, and why, across every tool and conversation. |
| **Acts** | Takes direct actions in your connected apps, and delegates longer work to coding and browser agents via the gateway. |
| **Policies** | Approval flows, escalation rules, plans, and audit logs so autonomy stays accountable. |

CORE decides what it can do safely, asks before sensitive actions, and leaves a trail you can review.

---

## What's inside CORE

| | |
|---|---|
| **Memory** | Tracks your preferences, decisions, goals, and directives across every tool and conversation, so every task starts with context loaded. |
| **Tasks** | One-shot or recurring work units with your spec, CORE's plan, live state, and a dedicated chat thread. Each task can spawn coding or browser sessions. |
| **Scratchpad** | A daily page for tasks, ideas, and work in progress. Type `[ ]` anywhere and CORE picks it up within 3 minutes. |
| **Connectors** | 50+ apps through one MCP endpoint, plus webhook triggers for proactive automation. GitHub, Linear, Jira, Slack, Gmail, Calendar, Sentry, Granola, Todoist, and more. |
| **Skills** | 100+ reusable instructions applied automatically based on context. Use built-in skills or write your own for repeatable workflows. |
| **Gateway** | Runs Claude Code, Codex, browser agents, and local commands on your machine or in Docker / Railway, so CORE keeps working when your laptop is closed. |
| **Model agnostic** | Bring your own provider: Anthropic, OpenAI, or open-weight models. Self-host the full stack for isolation. |

---

## CORE in action

### Delegate a coding task, come back to a PR.

Tell CORE what needs doing. It gathers context from your repo, apps, and memory, drafts a plan, runs a Claude Code or Codex session, handles blockers where it can, and brings back a PR. You review when it is done.

`[ ] Fix the race condition in the checkout flow from issue #312`

### Clear your backlog while you sleep.

Set a recurring task to pull from your backlog at a set time. CORE works through it while you are offline. Smooth runs wait for review in the morning. Stuck sessions come back with a tight question, not a stalled tab.

`[ ] Work through tonight's backlog starting at 11pm`

### Investigate alerts before they become interruptions.

Set a recurring task to watch Sentry, logs, or any alert source. When something fires, CORE investigates, pulls related traces and prior incidents, and decides whether to handle it or escalate.

A Sentry alert fires at 2am. CORE investigates, proposes a fix, and pings you on Slack for review.

### Get a morning brief that knows your work.

Set a recurring task to pull from email, GitHub, Linear, and Slack every morning. CORE summarizes what needs attention, skips what doesn't, and turns follow-ups into tasks automatically.

### Delegate from wherever you are.

Create tasks from Slack, WhatsApp, Telegram, email, or web. The gateway keeps running in Docker or Railway, so CORE can pick up work even when your laptop is closed.

---

## What CORE is not

| | |
|---|---|
| **Not a RAG wrapper.** | Memory is not just embedded chunks. It is a temporal knowledge graph that tracks what you decided, when, and why. |
| **Not a workflow builder.** | No drag-and-drop DAGs. You write what needs doing. CORE figures out the workflow and asks when it needs judgment. |
| **Not another Devin.** | CORE proposes plans, you approve. CORE asks for unblocks, you decide. CORE brings back PRs, you review. Agents do not merge on their own. |
| **Not a closed cloud assistant.** | CORE is open source, self-hostable, model-agnostic, and designed around your infrastructure. |

---

## Benchmark

CORE achieves **88.24%** average accuracy on the [LoCoMo benchmark](https://github.com/RedPlanetHQ/core-benchmark) across single-hop, multi-hop, open-domain, and temporal reasoning.

---

## Docs

- [**Memory**](https://docs.getcore.me/memory/overview) - Temporal knowledge graph, fact classification, intent-driven retrieval
- [**Scratchpad**](https://docs.getcore.me/concepts/scratchpad) - The daily surface where tasks and ideas start
- [**Tasks**](https://docs.getcore.me/concepts/tasks) - Plans, state, recurring work, and task-scoped context
- [**Toolkit**](https://docs.getcore.me/concepts/toolkit) - 1000+ actions across 50+ apps via MCP
- [**CORE Agent**](https://docs.getcore.me/concepts/meta-agent) - Triggers, memory, tools, and execution
- [**Gateway**](https://docs.getcore.me/access-core/overview) - WhatsApp, Slack, Telegram, email, web, and API access
- [**Skills**](https://docs.getcore.me/skills/overview) - Reusable instructions for repeatable workflows
- [**Self-hosting**](https://docs.getcore.me/self-hosting/setup) - Full deployment guide
- [**Changelog**](https://docs.getcore.me/opensource/changelog) - What has shipped

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

We're building CORE in public.

We share the roadmap and architectural decisions openly because the hardest problems in building a personal OS are best solved with the people using it. Star the repo, self-host it, share what you build, and open issues for what's broken or missing.

- [Discord](https://discord.gg/YGUZcvDjUa) - questions, ideas, show-and-tell
- [Contributing docs](https://docs.getcore.me/opensource/contributing) - how to contribute to CORE
- [`good-first-issue`](https://github.com/RedPlanetHQ/core/labels/good-first-issue) - start here

<a href="https://github.com/RedPlanetHQ/core/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=RedPlanetHQ/core" />
</a>

---

<div align="center">

**Self-host your personal AI OS.**

[Star this repo](https://github.com/RedPlanetHQ/core) · [Read the docs](https://docs.getcore.me) · [Join Discord](https://discord.gg/YGUZcvDjUa)

</div>
