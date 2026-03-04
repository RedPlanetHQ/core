---
name: youtube-studio-uploader
description: Automatischer YouTube Upload via Browser Automation
version: 1.0.0
---

# YouTube Studio Uploader Skill

Automatischer Upload zu YouTube via OpenClaw Browser Automation.

## Browser Script
`openclaw/browser/youtube-studio.sh` — Vollautomatische YouTube Studio Steuerung

## Befehle
- `./youtube-studio.sh login` — YouTube Studio Login pruefen
- `./youtube-studio.sh upload <video> <meta.json>` — Video hochladen
- `./youtube-studio.sh thumbnail <url> <img>` — Thumbnail aendern
- `./youtube-studio.sh analytics` — Analytics abrufen
- `./youtube-studio.sh comments` — Kommentare anzeigen
- `./youtube-studio.sh community <text>` — Community Post erstellen
- `./youtube-studio.sh shorts <video> [meta.json]` — Short hochladen
- `./youtube-studio.sh status` — Kanal-Status

## Workflow
1. Login pruefen: `./youtube-studio.sh login`
2. Video-Datei + Metadata vorbereiten (siehe templates/example-video-meta.json)
3. Human-in-the-Loop Preview + Approval
4. Browser oeffnet YouTube Studio automatisch
5. Upload-Flow: Video → Titel → Description → Tags → Thumbnail
6. Visibility setzen (public/unlisted/private)
7. Veroeffentlichen
8. Screenshot + Telegram Notification

## Metadata Format (metadata.json)
```json
{
  "title": "Video Titel (max 60 Zeichen)",
  "description": "Ausfuehrliche Beschreibung mit Keywords...",
  "tags": ["tag1", "tag2", "tag3"],
  "category": "Science & Technology",
  "language": "de",
  "thumbnail": "thumb.png",
  "visibility": "public",
  "chapters": "00:00 Intro\n01:00 Hauptteil\n05:00 Fazit"
}
```

## Regeln
- Immer Human-in-the-Loop vor Upload (Preview + Approval)
- Thumbnail muss vorher durch Critique gelaufen sein
- Description mindestens 3000 Zeichen
- Mindestens 15 relevante Tags
