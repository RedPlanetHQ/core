# CLAWMASTER v3.0 — Tools & Skills Registry

## Core Tools (Built-in)
| Tool | Beschreibung |
|------|-------------|
| `browser` | Chrome/Chromium via CDP (3 Profile: openclaw, work, relay) |
| `shell` | Terminal-Befehle auf Mac + Server |
| `files` | Dateien lesen/schreiben/bearbeiten |
| `telegram` | Nachrichten senden, Medien, Chat-Management |

## Installierte Skills

### Toggle Context (Pflicht)
- **Source:** ClawHub / Awesome Vault
- **Zweck:** Anti-Amnesia — synct Browser-Kontext jede Stunde
- **Config:** API-Key in openclaw.json, hourly Scheduler

### Pi Coder
- **Source:** Lokal (Shell-Skill)
- **Zweck:** OpenClaw startet Pi fuer Code-Generierung
- **Config:** Pi binary im PATH, Model-Config in skill

### Meta Ads Manager
- **Source:** Custom Skill
- **Zweck:** Browser Control fuer Meta Ads Dashboard
- **Config:** Budget-Limits, Human-in-the-Loop mandatory

### Trading Monitor
- **Source:** Custom Skill (ClawdBot-Pattern)
- **Zweck:** Polymarket/Crypto Monitoring (Paper-Modus!)
- **Config:** Alerts via Telegram, kein Auto-Trade ohne Freigabe

### Content Engine
- **Source:** Awesome Vault
- **Zweck:** X/Instagram/YouTube Posts generieren + schedulen
- **Config:** Platform-Credentials, Approval Flow

### SEO Ranker
- **Source:** Awesome Vault
- **Zweck:** Keyword Research, On-Page SEO, Backlink-Analyse
- **Config:** Target URLs, Konkurrenz-Liste

## Security Tools
| Tool | Zweck |
|------|-------|
| `openclaw-security-guard` | Scannt Skills auf Malware/Injection |
| `clawprint` | SHA-256 Hash-Chain Audit Trail |
| `openclaw security audit` | Built-in Security-Scan (--deep) |

## Vault-Quellen (Prioritaet)
1. Awesome OpenClaw Skills Vault (5.494 kuratierte Skills)
2. ClawHub Registry (13.729 Skills — immer erst scannen!)
3. Custom Skills (lokal gebaut, auditiert)
