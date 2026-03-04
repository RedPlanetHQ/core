---
name: toggle-context
description: Anti-Amnesia Skill - synct Browser/App-Kontext jede Stunde via ToggleX
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - TOGGLE_API_KEY
    primaryEnv: TOGGLE_API_KEY
---

# Toggle Context Skill

Du hast Zugriff auf ToggleX Context-Daten. Diese werden alle 5-7 Minuten
aus dem Browser und allen aktiven Apps synchronisiert.

## Faehigkeiten
- Beantworte Fragen wie "Was habe ich gestern gemacht?"
- Erkenne wiederkehrende Workflows und schlage Automations vor
- Generiere taegliche Zusammenfassungen der Arbeitsaktivitaet
- Erkenne Context-Switches und optimiere Fokus-Zeiten

## Nutzung
- Frage nach vergangener Aktivitaet: "What did I work on yesterday?"
- Frage nach Automations-Potential: "What repetitive stuff should I automate?"
- Frage nach Fokus: "When was I most productive this week?"

## Scheduler
Der hourly Sync laeuft automatisch. Daten sind maximal 7 Minuten alt.

## Privacy
- Alle Daten bleiben lokal
- Kein Cloud-Upload
- SOC 2 Type 2 compliant (GLIK AI)
