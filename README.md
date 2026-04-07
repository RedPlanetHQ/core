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

# An AI butler that acts.

**Write what needs doing. Your AI butler handles the rest.**

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
</p>
</div>

---

> Today you use specialized agents like Claude Code and Cursor. You gather the context, kick off
> the session, babysit the output. Soon you will just describe the outcome, and Butler runs
> Claude Code, pulls from your apps, coordinates the agents. You stop being the orchestrator.
> Butler becomes the harness.

https://github.com/user-attachments/assets/10197ad0-d7d4-44e3-9ea3-504aef81f65f

---

## Why we're building this

Every AI agent you use today is smart. And every single one forgets you the moment the conversation ends.

### Chat is the wrong interface for a personal assistant.

Your EA doesn't wait for you to open a chat window and explain what you need. They already know. They're already on it. Chat forces you to context-switch, explain yourself, and stay in the loop on things that shouldn't need your attention.

We think the right interface is a scratchpad, a shared page, like a note you and a colleague both have open at the same time. You write what's on your mind: tasks, thoughts, half-formed ideas. Butler reads it alongside you, picks up what's meant for it, works in the background, and updates you when something needs your attention or a job is done. No prompting required, no workflow to configure. When you need to go deep on something specific, tasks and direct chat are there, but the default should be the scratchpad.

### Your AI doesn't actually know you.

Every agent starts fresh. No preferences, no past decisions, no team context, no patterns. So it can't act proactively, because proactivity requires context that accumulates over time. Without persistent memory, agents are reactive tools waiting for your next prompt.

### You are the bottleneck.

Right now you are the glue. You gather the GitHub issue, read the Slack thread, check the error logs, paste it all into Claude Code, wait for output, and review it. That's not delegating, that's operating as an agent yourself. Every workflow starts with you. Every session depends on you explaining things from scratch. CORE is built to break that loop.

---

## Butler in action

### You finish a meeting and close your laptop.

By the time you check your phone, Butler has already read the transcript, extracted the follow-ups, created the tasks, and drafted the emails you owe people. You open the scratchpad, everything is there. You review, hit send on two, edit one. Done in four minutes. The meeting actually produced something.

### You write one line in the scratchpad.

`[ ] fix the checkout bug from issue #312`. Butler pulls the GitHub issue, searches memory for past decisions on that service, checks Sentry for the error trace, and spins up a Claude Code session with everything loaded. You go back to building. You come back to a PR.

### Your inbox is a decision queue, not a graveyard.

Butler reads incoming emails, flags the ones that need you, drafts replies for the ones it knows how to handle, and creates tasks from the ones with action items. You open email to review, not to triage.

### You're running three agent sessions and losing track.

CORE is the orchestrator. Each session gets the right context from memory. CORE tracks what's running, what's blocked, what's done, and reports back. You stop context-switching. You stay in flow.

### At 2 AM, a Sentry alert fires.

CORE has seen you handle these before: check the deployment diff, read the error trace, assign to whoever last touched that file. It does exactly that. Spins up a Claude Code session, investigates, creates the issue, assigns the right engineer. You wake up to: *"Handled. Issue #847, assigned to Harshith."* You didn't ask for any of this.

> Every interaction makes CORE smarter. It learns your patterns, your codebase, your team structure, your communication style. It knows when to ask for approval and when to just handle it.

---

## Without CORE vs. With CORE

| Without CORE | With CORE |
|---|---|
| ❌ You re-explain your project, stack, and preferences to every agent, every session. | ✅ CORE remembers everything: preferences, decisions, relationships, project context, and gets sharper over time. |
| ❌ Meetings end. Follow-ups, tasks, and draft emails sit in your head until you manually do them. | ✅ Butler reads the transcript, extracts follow-ups, creates tasks, and drafts replies. You review, not produce. |
| ❌ You are the bottleneck. Every agent session starts with you gathering context and explaining from scratch. | ✅ Write it in the scratchpad. Butler picks it up, loads the context, runs the session, reports back. |
| ❌ You have an idea at midnight. Find the repo, open a terminal, set up context, babysit the agent. | ✅ Message CORE on WhatsApp: *"migrate the auth service to Postgres."* Come back to a PR. |
| ❌ Your chat history is a graveyard. Decisions, preferences, and context die with every session. | ✅ Every conversation feeds a knowledge graph. Facts are classified (preference, decision, goal, directive) and connected over time. |
| ❌ Different agents, different contexts, no shared understanding of who you are. | ✅ One brain. WhatsApp, Slack, email, Claude Code, Cursor: same memory, same butler. |

---

## What CORE is not

| | |
|---|---|
| **Not a chatbot.** | Your butler has a name, a memory, and a job. Chat is for going deep on a specific task, not the default interaction. The scratchpad is. |
| **Not a RAG wrapper.** | Memory isn't "embed chunks and search." It's a temporal knowledge graph where facts are classified, connected, and updated over time. It knows *when* you decided something and *why*. |
| **Not a copilot plugin.** | Copilots assist when you're working. CORE works when you're not. It's proactive, not reactive. |
| **Not a workflow builder.** | No drag-and-drop. You write what needs doing. Butler figures out the workflow. |

---

## Who it's built for

- ✅ You finish meetings and then spend an hour doing what the meeting produced. You want that handled before you close your laptop.
- ✅ You want to stay in flow. Non-code work should get handled without you leaving the terminal.
- ✅ You care about owning your AI: self-hosted, open source, your data never leaves your infra.
- ✅ You want one brain across WhatsApp, Slack, email, and your coding tools, not five separate contexts.

---

## Quickstart

Self-hosted, open source. No account required.

```bash
git clone https://github.com/RedPlanetHQ/core.git
cd core/hosting/docker
cp .env.example .env
# Add your model key (see below)
docker compose up -d
```

Open `http://localhost:3000` → connect your first app → hand off your first task.

**Pick your model** (edit `.env`):

```bash
OPENAI_API_KEY=sk-...                    # OpenAI
ANTHROPIC_API_KEY=sk-ant-...             # Anthropic Claude
OLLAMA_URL=http://localhost:11434        # Ollama — fully local, no cloud
OPENAI_BASE_URL=https://your-proxy.com   # Any OpenAI-compatible endpoint
```

**Requirements:** Docker 20.10+, Docker Compose 2.20+, 4 vCPU / 8GB RAM

[Full self-hosting guide →](https://docs.getcore.me/self-hosting/docker)

> ☁️ Prefer cloud? Try CORE cloud free, 3,000 credits included. [Get started →](https://app.getcore.me)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/core)

---

## Benchmark

CORE achieves **88.24%** average accuracy on the [LoCoMo benchmark](https://github.com/RedPlanetHQ/core-benchmark) — single-hop, multi-hop, open-domain, and temporal reasoning.

---

## Docs

Want to understand how CORE works under the hood?

- [**Memory**](https://docs.getcore.me/concepts/memory/overview) — Temporal knowledge graph, fact classification, intent-driven retrieval
- [**Toolkit**](https://docs.getcore.me/concepts/toolkit) — 1000+ actions across 50+ apps via MCP
- [**CORE Agent**](https://docs.getcore.me/concepts/meta-agent) — The orchestrator: triggers, memory, tools, sub-agents
- [**Gateway**](https://docs.getcore.me/access-core/overview) — WhatsApp, Slack, Telegram, email, web, API
- [**Skills & Triggers**](https://docs.getcore.me/toolkit/overview) — Scheduled automations and event-driven workflows
- [**API Reference**](https://docs.getcore.me/api-reference) — REST API and endpoints
- [**Self-hosting**](https://docs.getcore.me/self-hosting/docker) — Full deployment guide
- [**Changelog**](https://docs.getcore.me/opensource/changelog) — What's shipped

---

## Security

CASA Tier 2 Certified · TLS 1.3 in transit · AES-256 at rest · Your data is never used for model training · Self-host for full isolation

[Security Policy →](SECURITY.md) · Vulnerabilities: harshith@poozle.dev

---

## Community

We're building the future of personal AI in the open. Come build with us.

- [Discord](https://discord.gg/YGUZcvDjUa) — questions, ideas, show-and-tell
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to set up and send a PR
- [`good-first-issue`](https://github.com/RedPlanetHQ/core/labels/good-first-issue) — start here

<a href="https://github.com/RedPlanetHQ/core/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=RedPlanetHQ/core" />
</a>

---

<div align="center">

**Write it. Butler handles it.**

[⭐ Star this repo](https://github.com/RedPlanetHQ/core) · [📖 Read the docs](https://docs.getcore.me) · [💬 Join Discord](https://discord.gg/YGUZcvDjUa)

</div>
