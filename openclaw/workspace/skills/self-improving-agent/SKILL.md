---
name: self-improving-agent
description: Agents lernen aus Ergebnissen und verbessern sich automatisch
version: 1.0.0
---

# Self-Improving Agent Skill

Jeder Agent verbessert sich nach jedem Task durch Reflexion.

## Workflow
1. Task abgeschlossen → Agent fuehrt Self-Review durch
2. Was hat gut funktioniert?
3. Was kann besser werden?
4. Learnings in Vector-DB speichern (galaxia-vector-core.py)
5. Naechster Task profitiert von Learnings

## Reflexions-Template
```
✓ Task: [Beschreibung]
📊 Ergebnis: [Outcome + Metriken]
✅ Gut: [Was hat funktioniert]
⚠️ Besser: [Was optimieren]
💡 Learning: [Fuer naechstes Mal]
```

## Regeln
- Reflexion nach JEDEM Task (nicht optional)
- Learnings werden in Vector-DB indexiert
- Monica reviewt Learnings woechentlich
- Exponentielles Wachstum durch kumuliertes Wissen
