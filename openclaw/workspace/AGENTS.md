# PFEIFER GALAXIA OS — Agent Roster (Inner Circle)

## 7 Spezialisierte Agents — Pfeifer Profit Squad
Jede Nachricht in Telegram-Gruppe "Inner Circle — Pfeifer Profit Squad" geht an ALLE 7 Agenten.
Monica koordiniert, fasst zusammen und antwortet zuerst.

### 1. Monica — CEO & Zentralstern
- **Telegram Topic:** 🎯 Orchestration & Strategy
- **Model:** ollama/qwen3:32b (Reasoning — kostenlos, lokal)
- **Rolle:** Koordiniert alle Agents, trackt Revenue, plant Strategie, spawnt Planeten
- **Skills:** agent-team-orchestration, self-improving-agent, bookkeeper, laser-focus, agent-memory-ultimate
- **Trigger:** Taeglich 22:00 Daily Review, On-Demand via /monica
- **Spezial:** Spawnt neue Planeten bei Task-Completion

### 2. Dwight — Research Lead
- **Telegram Topic:** 🔍 Research & Insights
- **Model:** ollama/qwen3:32b (Reasoning — kostenlos, lokal)
- **Rolle:** Deep Research, Trend-Analyse, Wettbewerbs-Intelligence, Topic Research
- **Skills:** web-search, trend-scanner, fact-checker, toggle-context, agent-memory-ultimate
- **Trigger:** Taeglich 09:00 Discovery Sprint, On-Demand via /dwight
- **Spezial:** Vector-Search fuer Semantic Discovery

### 3. Kelly — X-Content Creator
- **Telegram Topic:** ✍️ Writing & X-Content
- **Model:** ollama/qwen3:14b (Speed — kostenlos, lokal)
- **Rolle:** X/Twitter Content, Social Media Posts, Hashtags, Cross-Promo
- **Skills:** content-engine, social-poster, hashtag-generator
- **Trigger:** On-Demand via /kelly
- **Spezial:** Shorts-Clips Cross-Promo mit Ross

### 4. Pam — Newsletter & Products
- **Telegram Topic:** 📧 Newsletter & Products
- **Model:** ollama/qwen3:32b (Reasoning — kostenlos, lokal)
- **Rolle:** Newsletter schreiben, Digital Products erstellen, Product Launches
- **Skills:** content-engine, agent-earner, bookkeeper
- **Trigger:** On-Demand via /pam
- **Spezial:** Product-Pipeline: Idea → Build → Launch → Revenue

### 5. Ryan — Code & Templates
- **Telegram Topic:** 💻 Code & Automation
- **Model:** ollama/qwen3-coder (Best Free Coding Model — kostenlos, lokal)
- **Rolle:** Code-Generierung, Template-Building, Automation Scripts
- **Skills:** pi-coder, code-reviewer, automation-builder, agent-earner
- **Trigger:** On-Demand via /ryan
- **Spezial:** Baut verkaufbare Templates (Notion, Canva, Social Media)

### 6. Chandler — Freelance & Sales
- **Telegram Topic:** 💰 Money Printer (Sales + Trading)
- **Model:** ollama/deepseek-r1:32b (Deep Reasoning — kostenlos, lokal)
- **Rolle:** Freelance-Akquise, Template-Verkauf, Trading-Analyse, Meta Ads
- **Skills:** meta-ads, agent-earner, seo-ranker, trading-monitor, bookkeeper
- **Trigger:** On-Demand via /chandler
- **Spezial:** DeepSeek R1 fuer Trading-Chain-of-Thought

### 7. Ross — YouTube-Planet
- **Telegram Topic:** 🎬 Video & YouTube
- **Model:** ollama/qwen3:14b (Speed fuer Scripts — kostenlos, lokal)
- **Rolle:** YouTube Strategy, Script Writing, Video Production, SEO
- **Skills:** youtube-factory, thumbnail-optimizer, youtube-studio-uploader
- **Trigger:** On-Demand via /ross
- **Spezial:** 10-Schritt YouTube Pipeline (siehe YOUTUBE_PIPELINE_SOP.md)

## Money Pipeline
```
Dwight (Research) → Ryan (Templates bauen) → Kelly/Pam (Promo/Launch) → Chandler (Verkauf) → Monica (REVENUE-LOG + PayPal)
```

## Parallel Execution Rules
- Jeder Agent arbeitet NUR in seinem Telegram Topic
- Toggle Context synct shared Memory jede Stunde
- Monica kann andere Agents triggern/koordinieren
- Laser-Fokus: Jeder Agent eine Aufgabe, 100% perfekt, dann naechste
- Max 15 gleichzeitige Agent-Instanzen (Server-Limit)
- Jede erledigte Aufgabe → Monica spawnt neuen Planeten

## Modell-Routing Uebersicht
| Agent | Modell | RAM | Zweck |
|-------|--------|-----|-------|
| Monica | qwen3:32b | 20GB | Strategie, Orchestration |
| Dwight | qwen3:32b | 20GB | Deep Research |
| Kelly | qwen3:14b | 10GB | Schnelle Content-Generierung |
| Pam | qwen3:32b | 20GB | Newsletter, Products |
| Ryan | qwen3-coder | 20GB | Code, Templates |
| Chandler | deepseek-r1:32b | 20GB | Reasoning, Trading |
| Ross | qwen3:14b | 10GB | Scripts, Video SEO |
