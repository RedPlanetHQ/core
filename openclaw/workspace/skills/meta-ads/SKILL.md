---
name: meta-ads
description: Browser-basierte Meta Ads Automation mit Human-in-the-Loop Safety
version: 1.0.0
metadata:
  openclaw:
    requires:
      config:
        - browser
---

# Meta Ads Manager Skill

Automatisiere Meta (Facebook/Instagram) Ads Management ueber Browser Control.

## SAFETY RULES (NICHT VERHANDELBAR)
1. **Budget-Limit:** Max 50 EUR/Tag ohne zusaetzliche Approval
2. **Human-in-the-Loop:** JEDE Aenderung an Kampagnen braucht Bestaetigung
3. **Audit Trail:** Alle Aktionen werden via Clawprint protokolliert
4. **Kein Auto-Spend:** Niemals automatisch Budget erhoehen

## Workflows

### Kampagnen-Analyse
1. Browser oeffnen: Meta Business Suite
2. Snapshot der Kampagnen-Uebersicht
3. Performance-Metriken extrahieren (CPC, CTR, ROAS, Conversions)
4. Vergleich mit Vortag/Vorwoche
5. Empfehlungen generieren

### Creative Vorschlaege
1. Top-performing Ads analysieren
2. Neue Ad Copy Varianten generieren
3. A/B Test Vorschlaege
4. **Approval noetig vor Upload**

### Budget Optimierung
1. ROAS pro Kampagne berechnen
2. Budget-Shift Empfehlung (von low-ROAS zu high-ROAS)
3. Prognose fuer naechste 7 Tage
4. **Approval noetig vor Aenderung**

## Ziel: 5x ROI
- Tracking in revenue.json unter "x_posts" und "affiliate"
- Woechentlicher ROI Report an Monica (Planning Topic)
