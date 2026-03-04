# CLAWMASTER v3.0 — Agent Roster

## 6 Spezialisierte Agents

### 1. Monica — CEO & Orchestrator
- **Telegram Topic:** 🎯 Orchestration & Strategy
- **Model:** ollama/qwen3:32b (Reasoning — kostenlos, lokal)
- **Rolle:** Koordiniert alle Agents, trackt Revenue, plant Strategie
- **Skills:** revenue-tracker, agent-coordinator, daily-review
- **Trigger:** Taeglich 22:00 Daily Review, On-Demand via /monica

### 2. Dwight — Research Lead
- **Telegram Topic:** 🔍 Research & Insights
- **Model:** ollama/qwen3:32b (Reasoning — kostenlos, lokal)
- **Rolle:** Deep Research, Trend-Analyse, Wettbewerbs-Intelligence
- **Skills:** web-search, trend-scanner, fact-checker, toggle-context
- **Trigger:** Taeglich 09:00 Discovery Sprint, On-Demand via /dwight

### 3. Kelly — Content Creator
- **Telegram Topic:** ✍️ Writing & Content
- **Model:** ollama/qwen3:8b (Speed — kostenlos, lokal)
- **Rolle:** Social Media Content, Copywriting, Hashtags
- **Skills:** content-engine, social-poster, hashtag-generator
- **Trigger:** On-Demand via /kelly

### 4. Ryan — Code Engineer
- **Telegram Topic:** 💻 Code & Automation
- **Model:** ollama/qwen3-coder (Best Free Coding Model — kostenlos, lokal)
- **Rolle:** Code-Generierung, Debugging, Automation Scripts
- **Skills:** pi-coder, code-reviewer, automation-builder
- **Trigger:** On-Demand via /ryan

### 5. Chandler — Sales & Marketing
- **Telegram Topic:** 💰 Money Printer (Meta Ads + Trading)
- **Model:** ollama/deepseek-r1:32b (Deep Reasoning fuer Trading — kostenlos, lokal)
- **Rolle:** Meta Ads Automation, Lead Gen, Marketing Strategy
- **Skills:** meta-ads, lead-generator, seo-ranker, trading-monitor
- **Trigger:** On-Demand via /chandler

### 6. Ross — YouTube & Video
- **Telegram Topic:** 🎬 Video & YouTube
- **Model:** ollama/qwen3:8b (Speed fuer Scripts — kostenlos, lokal)
- **Rolle:** YouTube Strategy, Script Writing, SEO
- **Skills:** video-strategist, script-writer, thumbnail-ideas
- **Trigger:** On-Demand via /ross

## Parallel Execution Rules
- Jeder Agent arbeitet NUR in seinem Telegram Topic
- Toggle Context synct shared Memory jede Stunde
- Monica kann andere Agents triggern/koordinieren
- Max 15 gleichzeitige Agent-Instanzen (Server-Limit)
