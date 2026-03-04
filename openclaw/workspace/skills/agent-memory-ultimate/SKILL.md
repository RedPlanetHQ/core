---
name: agent-memory-ultimate
description: Langzeit-Gedaechtnis via Vector-DB + Toggle Context
version: 1.0.0
---

# Agent Memory Ultimate Skill

Kombiniert Toggle Context (Anti-Amnesia) mit Galaxia Vector Core fuer Langzeit-Gedaechtnis.

## Komponenten
1. **Toggle Context** — Synct Browser-Kontext jede Stunde
2. **Galaxia Vector Core** — Semantic Search ueber alles Wissen
3. **Memory Snapshots** — CONTEXT_SNAPSHOT.md wird stuendlich aktualisiert

## Befehle
- `/remember [info]` — Speichere Information in Vector-DB
- `/recall [query]` — Semantic Search ueber Galaxia-Gedaechtnis
- `/context-sync` — Manueller Context Sync
- `/memory-status` — Wie viele Chunks, letzte Sync-Zeit

## Workflow
1. Jede Stunde: Toggle Context synct Browser → Memory
2. Bei jedem Task: Agent sucht relevante Erinnerungen
3. Nach jedem Task: Learnings werden indexiert
4. Woechentlich: Monica reviewt und konsolidiert

## Tools
- `galaxia-vector-core.py search "[query]"` — Semantic Search
- `galaxia-vector-core.py index` — Re-Indexierung
- CONTEXT_SNAPSHOT.md — Aktueller State

## Regeln
- Kontext NIE verlieren (Kosmische Regel)
- Jeder Agent hat Zugriff auf das gesamte Galaxia-Gedaechtnis
- Sensitive Daten (Passwoerter, Tokens) werden NICHT indexiert
- Vector-DB liegt in /root/galaxia/vector_db/ (lokal, encrypted)
