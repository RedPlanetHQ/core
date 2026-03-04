---
name: trading-monitor
description: Agentic Trading Monitor (Paper-Modus!) - Polymarket/Crypto Signale
version: 1.0.0
metadata:
  openclaw:
    requires:
      config:
        - browser
---

# Trading Monitor Skill (ClawdBot-Pattern)

Monitoring und Analyse von Trading-Signalen. Basiert auf dem ClawdBot
6-Agent Trading Pattern, orchestriert durch OpenClaw.

## SAFETY RULES (ABSOLUT NICHT VERHANDELBAR)
1. **DEFAULT = PAPER-MODUS** — Kein echtes Geld ohne /approve Befehl
2. **Human-in-the-Loop PFLICHT** bei jeder Trade-Empfehlung
3. **Clawprint Audit Trail** fuer jede Aktion (tamper-proof)
4. **Budget-Limit:** Max Paper-Portfolio 10.000 EUR Simulation
5. **Kein Auto-Trade** — Immer nur Signal + Empfehlung + Warte auf Freigabe

## 6 Sub-Agent Pattern
1. **Monitor Agent** — Preis-Feeds und Markt-Daten scannen
2. **Research Agent** — Fundamentale Analyse, News-Sentiment
3. **Analysis Agent** — Technische Analyse, Pattern-Erkennung
4. **Risk Agent** — Position Sizing, Stop-Loss Berechnung
5. **Execution Agent** — Paper-Trade ausfuehren (NUR nach Approval)
6. **Report Agent** — Performance-Tracking, Gewinn/Verlust Report

## Workflows

### Signal Detection
1. Polymarket / Crypto Maerkte scannen (Browser)
2. Ungewoehnliche Volumen-Spikes erkennen
3. Sentiment-Analyse aus News/Social Media
4. Signal bewerten: Confidence Score 1-10
5. Alert wenn Score > 7

### Paper Trade
1. Signal mit Score > 7 erkannt
2. Risk-Analyse: Position Size + Stop-Loss
3. **Telegram Alert an Maurice mit Empfehlung**
4. Warte auf /approve oder /reject
5. Bei /approve: Paper-Trade loggen
6. Performance tracken

### Daily Report
- Open Positions
- P&L (Paper)
- Top Signals des Tages
- Markt-Sentiment Summary

## Output
- Alle Trades in openclaw/memory/trades.json (Paper!)
- Alerts via Telegram Money Printer Topic
- Weekly Performance Report an Monica
