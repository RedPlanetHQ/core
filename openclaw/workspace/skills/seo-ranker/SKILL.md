---
name: seo-ranker
description: Keyword Research, On-Page SEO Analyse, und Ranking-Monitoring
version: 1.0.0
metadata:
  openclaw:
    requires:
      config:
        - browser
---

# SEO Ranker Skill

Keyword Research, On-Page SEO Optimierung, Backlink-Analyse und
Ranking-Monitoring via Browser Control.

## Workflows

### Keyword Research
1. Seed Keyword eingeben
2. Browser: Google Suggest, "People Also Ask" scrapen
3. Suchvolumen + Difficulty schaetzen
4. Long-Tail Varianten generieren
5. Top 10 Ergebnisse analysieren (Content Gap)

### On-Page SEO Audit
1. URL analysieren (Title, Meta, H1-H6, Content)
2. Keyword-Density pruefen
3. Internal Linking Struktur
4. Page Speed Faktoren
5. Empfehlungen generieren

### Competitor Analysis
1. Target Keyword eingeben
2. Top 10 Seiten analysieren
3. Content-Laenge, Struktur, Keywords vergleichen
4. Backlink-Profile schaetzen
5. Luecken identifizieren

### Ranking Monitor
1. Target Keywords + URLs in watchlist.json
2. Woechentlich Rankings checken (Browser)
3. Ranking-Veraenderungen tracken
4. Alert bei signifikanten Aenderungen (>5 Positionen)

## Output
- Keyword-Listen in openclaw/memory/seo-keywords.json
- Audit-Reports strukturiert (Score 1-100)
- Ranking-History in openclaw/memory/seo-rankings.json
