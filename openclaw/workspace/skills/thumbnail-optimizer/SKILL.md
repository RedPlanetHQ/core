---
name: thumbnail-optimizer
description: YouTube Thumbnail Erstellung + AI Critique
version: 1.0.0
---

# Thumbnail Optimizer Skill

Erstelle und optimiere YouTube Thumbnails mit Pillow + Ollama Multimodal Critique.
Siehe THUMBNAIL_OPTIMIZER_SOP.md fuer vollstaendige Dokumentation.

## Befehle
- `/thumbnail-optimizer [Titel] --style tech-bold-red` — Thumbnail erstellen
- `/thumbnail-critique [bild]` — AI Critique
- `/thumbnail-ab [Titel]` — A/B Varianten in allen Styles

## Styles
- tech-bold-red: AI, Tech, Coding
- money-green: Finance, Trading
- clean-minimal: Tutorial, How-To
- shock-yellow: Clickbait, Viral

## Script
```bash
python3 galaxia/scripts/thumbnail_optimizer.py --title "Titel" --style tech-bold-red --output thumb.png
```
