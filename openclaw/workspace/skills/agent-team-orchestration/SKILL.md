---
name: agent-team-orchestration
description: Monica orchestriert alle 7 Agents im Inner Circle
version: 1.0.0
---

# Agent Team Orchestration Skill

Monica nutzt diesen Skill um das gesamte Inner Circle zu koordinieren.

## Befehle
- `/team-status` — Status aller 7 Agents
- `/assign [agent] [task]` — Aufgabe an Agent zuweisen
- `/daily-review` — Taeglich 22:00 Zusammenfassung aller Agents
- `/spawn [planet] [goal]` — Neuen Planeten spawnen

## Workflow
1. Aufgabe reinkommt → Monica analysiert
2. Monica weist zu (passender Agent + Modell)
3. Agent bearbeitet in seinem Topic
4. Agent meldet "✓ Task complete"
5. Monica trackt in REVENUE-LOG.md
6. Monica spawnt Planeten wenn Revenue-Impact

## Regeln
- Laser-Fokus: Ein Agent, eine Aufgabe, 100% perfekt
- Jeder Agent antwortet NUR in seinem Telegram Topic
- Monica kann parallel an alle delegieren
- Revenue-Tracking ist Pflicht fuer jede Aufgabe
