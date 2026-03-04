# CLAWMASTER v3.0 — Security Checklist

## Vor jeder Skill-Installation
- [ ] Skill in Awesome Vault pruefen (5.494 kuratierte Skills)
- [ ] `openclaw security audit --deep` ausfuehren
- [ ] SKILL.md manuell lesen auf: rm -rf, base64, curl|bash, broad file access
- [ ] Bei ClawHub-Skills: Sterne + Reports checken (3+ Reports = auto-hidden)

## Installierte Security Tools

### 1. openclaw-security-guard (npm)
```bash
npm install -g openclaw-security-guard
```
- SecretsScanner: Findet leaked API Keys, Tokens, Credentials
- ConfigAuditor: Prueft openclaw.json Sicherheitseinstellungen
- McpServerAuditor: Scannt MCP Server Konfigurationen
- PromptInjection: 50+ Patterns, 9 Threat-Kategorien
- Zero Telemetry

### 2. Clawprint (Audit Trail)
```bash
# Installation
git clone https://github.com/cyntrisec/clawprint.git
cd clawprint && npm install

# Daemon starten (24/7 passive Ueberwachung)
clawprint daemon --gateway ws://127.0.0.1:18789

# Audit verifizieren
clawprint verify  # -> SEALED oder COMPROMISED
```
- SHA-256 Hash-Chain Ledger
- Jeder Tool-Call wird aufgezeichnet
- Automatische Secret-Redaction (API Keys, JWTs, AWS Keys)
- Tamper-proof: Verify meldet sofort wenn Kette gebrochen

### 3. Built-in Security Audit
```bash
openclaw security audit --deep --json
openclaw security audit --fix  # Auto-Fix bekannter Issues
```

## Trading-spezifische Sicherheit
- [ ] Clawprint Daemon laeuft bei jedem Trading-Session
- [ ] Paper-Modus ist DEFAULT (kein Live-Trading ohne /approve)
- [ ] Budget-Limits in Meta Ads eingestellt (max 50 EUR/Tag)
- [ ] Human-in-the-Loop fuer alle Geld-Aktionen
- [ ] Woechentlicher Audit-Trail Review

## Allgemeine Regeln
- Lokal zuerst: Ollama + OpenClaw = 100% on-device
- Keine Cloud-API Keys in Skills (nur in .env)
- .env NIE committen (ist in .gitignore)
- Tailscale fuer verschluesselte Verbindung Mac <-> Server
- SSH nur mit Key-Auth (kein Passwort)
