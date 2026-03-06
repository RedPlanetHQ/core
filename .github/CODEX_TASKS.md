# CODEX Tasks - Wichtige Arbeiten für AI-Modelle

> Diese Aufgaben sind für Codex, Copilot und andere AI-Coding-Agents in VS Code.
> Jede Aufgabe hat Priorität, betroffene Dateien und klare Anweisungen.

---

## P0 - KRITISCH (Sofort erledigen)

### 1. Vector Provider: Qdrant implementieren
**Datei**: `packages/providers/src/vector/qdrant.ts`
**Status**: Stub - nur TODO Kommentar
**Aufgabe**: Vollständige QdrantVectorProvider Klasse implementieren.
- Verbindung zu Qdrant (qdrant-js client)
- CRUD Operationen: upsert, search, delete vectors
- Collection management (create if not exists)
- Batch operations für Performance
- Error handling + retry logic
**Referenz**: Schau dir die pgvector Implementation als Vorlage an

### 2. Vector Provider: Turbopuffer implementieren
**Datei**: `packages/providers/src/vector/turbopuffer.ts`
**Status**: Stub - nur TODO Kommentar
**Aufgabe**: Vollständige TurbopufferVectorProvider Klasse implementieren.
- REST API Integration (turbopuffer.com)
- Gleiche Interface wie QdrantVectorProvider
- Namespace management
- Batch upsert support

### 3. Model Provider: Vercel AI Wrapper vervollständigen
**Datei**: `packages/providers/src/model/vercel-ai.ts`
**Status**: Stub - nur TODO Kommentar
**Aufgabe**: VercelAIModelProvider implementieren der alle AI SDK Provider wrapped.
- OpenAI, Anthropic, Google, Bedrock Support
- Streaming + non-streaming
- Tool/Function calling support
- Token counting
- Model selection by config

### 4. OAuth2 PKCE Fix
**Datei**: `apps/webapp/app/services/oauth2.server.ts` (Zeile 470)
**Status**: Bug - PKCE Validierung fehlerhaft
**Aufgabe**: PKCE code_verifier/code_challenge Flow fixen.
- Untersuche warum der PKCE Challenge nicht korrekt gesendet wird
- Implementiere korrekte S256 Validierung
- Teste mit allen OAuth2 Integrations (Google, GitHub, etc.)

---

## P1 - HOCH (Diese Woche)

### 5. Stripe Billing: Echte Subscription-Beträge
**Dateien**:
- `apps/webapp/app/services/billing.server.ts` (Zeile 60)
- `apps/webapp/app/trigger/utils/utils.ts` (Zeile 494)
**Status**: Hardcoded `subscriptionAmount: 0`
**Aufgabe**: Subscription-Betrag aus Stripe API holen.
- `stripe.subscriptions.retrieve()` nutzen
- Amount aus `subscription.items.data[0].price.unit_amount` lesen
- Caching einbauen (nicht bei jedem Call Stripe anfragen)
- Fallback wenn kein Subscription existiert

### 6. Failed Payment Email Notification
**Datei**: `apps/webapp/app/routes/api.webhooks.stripe.tsx` (Zeile 370)
**Status**: TODO - keine Email bei fehlgeschlagener Zahlung
**Aufgabe**: Email senden wenn Stripe Payment fehlschlägt.
- Nutze das bestehende Email-System in `packages/emails/`
- Template erstellen für Payment-Failed Notification
- User benachrichtigen mit Zahlungsdetails + Link zum Dashboard
- Retry-Info mitgeben

### 7. Drift Calculation implementieren
**Datei**: `apps/webapp/app/services/synthesis-utils.ts` (Zeile 9)
**Status**: TODO - Funktion leer
**Aufgabe**: Drift-Berechnung für Synthese implementieren.
- Analysiere den Kontext: wie wird drift in der Knowledge Graph Synthese verwendet?
- Berechne Veränderung/Abweichung über Zeit
- Integration mit dem bestehenden Synthese-Pipeline

### 8. Trigger Utils aufräumen
**Datei**: `apps/webapp/app/trigger/utils/utils.ts` (Zeile 25)
**Status**: TODO - Helper Funktionen sollen raus
**Aufgabe**: Helper-Funktionen in eigene Module extrahieren.
- Analysiere welche Funktionen in utils.ts sind
- Gruppiere nach Verantwortlichkeit
- Erstelle separate Dateien (z.B. `billing-utils.ts`, `sync-utils.ts`)
- Alle Imports updaten

---

## P2 - MITTEL (Nächste 2 Wochen)

### 9. Test Coverage aufbauen
**Bereich**: Gesamtes Projekt
**Status**: Praktisch keine Tests vorhanden
**Aufgabe**: Test-Infrastruktur + erste Tests.
- Vitest Setup in root + packages
- Unit Tests für `packages/providers/` (Vector, Graph, Model)
- Unit Tests für `packages/types/` Validierung
- Integration Tests für CORE API Endpoints
- Test für Telegram Bot Message Handling

### 10. Integration Health Checks
**Bereich**: `integrations/` (alle 16 Module)
**Aufgabe**: Jede Integration auf Vollständigkeit prüfen.
- OAuth Flow funktioniert?
- Sync Jobs laufen korrekt?
- Webhook Handler implementiert?
- Rate Limiting korrekt?
- Error Recovery vorhanden?
- Erstelle Report welche Integrations Lücken haben

### 11. CI/CD Pipeline aktualisieren
**Datei**: `.github/workflows/submit.yml`
**Status**: Referenziert nicht-existierendes `apps/extension`
**Aufgabe**: Workflow fixen oder entfernen.
- Prüfe ob Browser Extension noch relevant ist
- Wenn ja: Pfade korrigieren
- Wenn nein: Workflow entfernen
- Optional: Typecheck + Lint Workflow hinzufügen

---

## Hinweise für AI-Modelle

### Konventionen
- TypeScript strict mode
- Remix: Server-Code in `.server.ts` Dateien
- Prisma für DB Operationen
- Alle Env-Vars über `process.env`, nie hardcoden
- Error Messages auf Englisch, UI Text auf Deutsch wenn User-facing

### Vor dem Coden
1. Lies die betroffene Datei komplett
2. Verstehe den Kontext (umliegende Dateien, Imports)
3. Schau dir ähnliche Implementations im Projekt an
4. Halte dich an bestehende Patterns

### Nach dem Coden
1. TypeScript Fehler checken (`pnpm turbo typecheck`)
2. Build testen (`pnpm turbo build`)
3. Keine neuen Dependencies ohne guten Grund
