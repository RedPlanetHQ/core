---
name: pi-coder
description: Steuert Pi (lokales AI Coding Tool) per Shell fuer Code-Generierung
version: 1.0.0
metadata:
  openclaw:
    requires:
      anyBins:
        - pi
        - npx
---

# Pi Coder Skill

Steuere das Pi Coding Tool (shittycodingagent.ai) direkt aus OpenClaw.
Pi ist ein minimalistisches, lokales, open-source Coding Tool mit nur 4 Tools
(read, write, edit, bash) und ~300 Wort System-Prompt.

## Workflows

### Website bauen
```bash
cd /tmp/pi-workspace && pi --message "Build a landing page for [beschreibung]"
```

### Code generieren
```bash
pi --message "[aufgabe]" --model glm4:9b-chat
```

### Zwei Instanzen parallel
```bash
pi --message "[projekt-1]" &
pi --message "[projekt-2]" &
wait
```

## Modell-Wechsel
Pi unterstuetzt Model-Swapping mid-session:
- `glm4:9b-chat` (Standard, lokal via Ollama)
- `qwen3.5` (Alternative)
- Anthropic/OpenAI Keys optional fuer Cloud-Fallback

## Regeln
- Immer in /tmp/pi-workspace oder projektspezifischem Verzeichnis arbeiten
- Code nach Generierung reviewen bevor Import in Hauptprojekt
- Keine API-Keys oder Secrets in Pi-Prompts
- Output wird automatisch in OpenClaw importiert

## Installation
```bash
npm install -g pi-mono
```
