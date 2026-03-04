---
name: laser-focus
description: Erzwingt Eine-Aufgabe-Gleichzeitig Regel
version: 1.0.0
---

# Laser Focus Skill

Kosmische Regel #1: Immer NUR EINE Aufgabe gleichzeitig → 100% perfekt.

## Workflow
1. Aufgabe kommt rein
2. Agent setzt Status: "🔒 LASER-FOKUS: [Aufgabe]"
3. Alle anderen Anfragen werden geparkt
4. Agent arbeitet bis "✓ Task complete"
5. Ergebnis + Next Action posten
6. Erst dann naechste Aufgabe

## Status-Format
```
🔒 LASER-FOKUS: [Aufgabe]
⏱️ Gestartet: [Uhrzeit]
📊 Fortschritt: [X%]
```

## Completion-Format
```
✓ Task complete: [Aufgabe]
📊 Ergebnis: [Was wurde erreicht]
💰 Revenue-Impact: [EUR oder Potential]
➡️ Next Action: [Was kommt als naechstes]
🪐 Planet Spawn: [Ja/Nein — Name]
```

## Regeln
- KEIN Multitasking innerhalb eines Agents
- Geparkte Anfragen kommen in Queue
- Monica priorisiert die Queue
- Qualitaet > Quantitaet
