---
name: x-twitter-browser
description: Automatische X/Twitter Steuerung via OpenClaw Browser
version: 1.0.0
---

# X/Twitter Browser Skill

Vollautomatische X/Twitter Steuerung via OpenClaw Browser Automation.
Agent: Kelly (Content Creator)

## Browser Script
`openclaw/browser/x-twitter.sh` — Vollautomatische X/Twitter Steuerung

## Befehle
- `./x-twitter.sh login` — X Login pruefen
- `./x-twitter.sh tweet <text>` — Tweet posten
- `./x-twitter.sh thread <thread.json>` — Thread posten
- `./x-twitter.sh reply <url> <text>` — Auf Tweet antworten
- `./x-twitter.sh trending` — Trending Topics anzeigen
- `./x-twitter.sh analytics` — Analytics Dashboard
- `./x-twitter.sh engage <query>` — Engagement-Session (relevante Tweets finden)
- `./x-twitter.sh dm <user> <text>` — DM senden
- `./x-twitter.sh profile` — Profil-Status

## Thread JSON Format
```json
{
  "posts": [
    "Post 1 — Hook (provokante Frage oder Statistik)",
    "Post 2 — Erster Kernpunkt mit Mehrwert",
    "Post 3 — Zweiter Kernpunkt",
    "Post 4 — Dritter Kernpunkt",
    "Post 5 — CTA (Call to Action)",
    "Post 6 — Engagement-Frage an Community"
  ]
}
```

## Workflow
1. Login pruefen: `./x-twitter.sh login`
2. Content generieren (Kelly schreibt Text)
3. Human-in-the-Loop Preview + Approval
4. Browser oeffnet X automatisch
5. Tweet/Thread posten
6. Screenshot + Telegram Notification

## Content Regeln
- Hook in den ersten 2 Zeilen (entscheidend fuer Engagement)
- Max 280 Zeichen pro Tweet (oder X Premium fuer laengere Posts)
- Threads: 5-8 Posts optimal
- Immer CTA am Ende
- Hashtags sparsam (2-3 max pro Tweet)
- Engagement-Sessions: Like + Reply auf relevante Tweets in der Nische

## Templates
Siehe `openclaw/browser/templates/example-thread.json` fuer Beispiel-Thread.
