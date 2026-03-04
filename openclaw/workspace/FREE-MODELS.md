# CLAWMASTER v3.0 — 100% Kostenlose Open Source Modelle

## ZERO KOSTEN POLICY
- Keine API Keys
- Keine Subscriptions
- Keine Cloud-Dienste
- Alles laeuft lokal auf dem Hetzner Server (128GB RAM, 2x NVMe)
- Ollama = kostenloser Model-Runner

## Empfohlene Modelle (alle kostenlos via Ollama)

### Primaer-Modell: Qwen3:32b
```bash
ollama pull qwen3:32b
```
- **RAM:** ~20GB (Q4_K_M)
- **Staerken:** Reasoning, General Chat, 100+ Sprachen, 256K Context
- **Lizenz:** Apache 2.0 (komplett frei)
- **Besser als:** GPT-4o-mini, Gemini Flash in Benchmarks

### Coding-Modell: Qwen3-Coder
```bash
ollama pull qwen3-coder
```
- **RAM:** ~20GB (Q4_K_M)
- **Staerken:** Agentic Coding, Multi-File, Repository-Scale
- **Vergleichbar mit:** Claude Sonnet fuer Code
- **Lizenz:** Apache 2.0

### Reasoning-Modell: DeepSeek-R1:32b
```bash
ollama pull deepseek-r1:32b
```
- **RAM:** ~20GB (Q4_K_M)
- **Staerken:** Step-by-Step Reasoning, Mathe, Logik, Trading-Analyse
- **Thinking Mode:** Zeigt Denkprozess wie o1/o3
- **Lizenz:** MIT (komplett frei)

### Schnell-Modell: Qwen3:8b
```bash
ollama pull qwen3:8b
```
- **RAM:** ~5GB (Q4_K_M)
- **Staerken:** Schnelle Antworten, Content-Generierung, Chat
- **Speed:** 3-5x schneller als 32b Modelle
- **Lizenz:** Apache 2.0

### Multimodal: Llama 4 Scout
```bash
ollama pull llama4
```
- **RAM:** ~15GB
- **Staerken:** Bilder + Text verstehen, 10M Context Window
- **Nutzen:** Screenshot-Analyse, Ad Creative Review, Thumbnail-Bewertung
- **Lizenz:** Llama Community License (frei fuer kommerziell)

## Server RAM Planung (128GB verfuegbar)

| Modell | RAM | Zweck |
|--------|-----|-------|
| Qwen3:32b | 20GB | Haupt-Agent (Monica, Dwight) |
| Qwen3-Coder | 20GB | Code-Agent (Ryan) |
| DeepSeek-R1:32b | 20GB | Reasoning + Trading (Chandler) |
| Qwen3:8b | 5GB | Content + Video (Kelly, Ross) |
| Llama 4 | 15GB | Multimodal Tasks |
| System + OS | 10GB | Linux, Ollama, OpenClaw Gateway |
| **Reserve** | **38GB** | **Fuer groessere Modelle oder parallel** |

**Total: ~90GB von 128GB genutzt — 38GB Reserve**

## Quick Install (1 Befehl pro Modell)
```bash
# Alle 5 Modelle auf einmal pullen
ollama pull qwen3:32b &
ollama pull qwen3-coder &
ollama pull deepseek-r1:32b &
ollama pull qwen3:8b &
ollama pull llama4 &
wait
echo "Alle Modelle geladen!"
```

## Model-Routing pro Agent
| Agent | Modell | Grund |
|-------|--------|-------|
| Monica (CEO) | qwen3:32b | Strategie braucht starkes Reasoning |
| Dwight (Research) | qwen3:32b | Deep Analysis |
| Kelly (Content) | qwen3:8b | Speed fuer viele Posts |
| Ryan (Code) | qwen3-coder | Bestes Coding-Modell |
| Chandler (Money) | deepseek-r1:32b | Trading braucht Reasoning-Chain |
| Ross (Video) | qwen3:8b | Scripts brauchen Speed nicht Power |

## Vergleich: Open Source vs. Paid APIs

| Feature | Open Source (kostenlos) | Paid APIs |
|---------|----------------------|-----------|
| Kosten/Monat | 0 EUR | 50-500 EUR |
| Datenschutz | 100% lokal | Daten gehen an Cloud |
| Speed | Abhaengig von Hardware | Konsistent schnell |
| Verfuegbarkeit | 24/7 ohne Limits | Rate Limits, Downtime |
| Context Window | Bis 256K (Qwen3) | Variabel |
| Qualitaet | 95% von GPT-4o | 100% |

**Fazit:** Mit 128GB RAM Server ist die Open Source Loesung praktisch gleichwertig
mit Paid APIs — bei NULL Kosten und maximaler Datensicherheit.
