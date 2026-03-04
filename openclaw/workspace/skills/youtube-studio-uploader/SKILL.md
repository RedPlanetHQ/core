---
name: youtube-studio-uploader
description: Automatischer YouTube Upload via Browser Automation
version: 1.0.0
---

# YouTube Studio Uploader Skill

Automatischer Upload zu YouTube via OpenClaw Browser Automation.

## Befehle
- `/youtube-upload [video] [metadata.json]` — Video hochladen
- `/youtube-schedule [video] [datetime]` — Video schedulen

## Workflow
1. Video-Datei + Metadata vorbereiten
2. OpenClaw oeffnet YouTube Studio im Browser
3. Upload-Flow automatisieren
4. Thumbnail setzen
5. Metadata eintragen (Titel, Description, Tags)
6. Veroeffentlichen oder schedulen

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
