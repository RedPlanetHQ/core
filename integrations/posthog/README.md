# PostHog Integration

Connect PostHog to CORE to query product analytics, manage feature flags, explore saved insights, track user personas, and annotate your timeline.

## Overview

The PostHog integration uses your **Personal API Key** to authenticate and exposes both a scheduled sync (every 30 minutes) and a full set of MCP tools for on-demand queries.

### What gets synced automatically

- **Feature flags** — newly created or updated flags
- **Insights** — recently created saved insights (funnels, trends, retention)
- **Annotations** — new annotations added to the project timeline

## Authentication

1. In PostHog, go to **Settings → Personal API Keys**
2. Click **Create personal API key** and grant at minimum **Read** access to the project
3. Copy the key (starts with `phx_`)
4. When connecting in CORE, paste the key and set your **PostHog Host**:
   - US Cloud: `https://app.posthog.com`
   - EU Cloud: `https://eu.posthog.com`
   - Self-hosted: your custom URL (e.g. `https://posthog.yourcompany.com`)

## Environment Variables

| Variable | Description |
|---|---|
| `POSTHOG_API_KEY` | Personal API Key (used only if managing via env) |
| `POSTHOG_HOST` | PostHog instance URL (default: `https://app.posthog.com`) |

## MCP Tools

### Events

#### `posthog_list_events`
List recent captured events. Filter by event name, date range, or user.

**Parameters:**
- `limit` (optional, default 50): Max events to return
- `event` (optional): Filter by event name (e.g. `$pageview`)
- `after` / `before` (optional): ISO 8601 timestamp range
- `distinct_id` (optional): Filter events for a specific user

#### `posthog_get_event`
Get a specific event by ID.

- `event_id` (required): ID of the event

#### `posthog_list_event_definitions`
List all event types ever captured in the project.

- `search` (optional): Search by name
- `limit` (optional, default 50)

---

### Feature Flags

#### `posthog_list_feature_flags`
List feature flags, optionally filtered to active flags only.

- `active_only` (optional): Return only active flags
- `search` (optional): Search by name or key

#### `posthog_get_feature_flag`
Get details of a specific feature flag.

- `flag_id` (required): Numeric flag ID

#### `posthog_evaluate_feature_flag`
Evaluate a feature flag for a specific user.

- `flag_key` (required): Flag key string
- `distinct_id` (required): User's distinct ID
- `groups` (optional): Group membership for group-based flags

---

### Insights

#### `posthog_list_insights`
List saved insights (trends, funnels, retention, etc.).

- `limit` (optional, default 20)
- `search` (optional): Search by name

#### `posthog_get_insight`
Get a specific saved insight.

- `insight_id` (required): Numeric insight ID

---

### Persons

#### `posthog_list_persons`
List identified users in the project.

- `search` (optional): Search by name, email, or distinct_id
- `limit` (optional, default 20)

#### `posthog_get_person`
Get profile details for a specific person.

- `person_id` (required): Numeric person ID

---

### Dashboards

#### `posthog_list_dashboards`
List dashboards in the project.

- `limit` (optional, default 20)

---

### Annotations

#### `posthog_list_annotations`
List annotations on the project or dashboards.

- `limit` (optional, default 50)
- `scope` (optional): `"project"` or `"dashboard"`

#### `posthog_create_annotation`
Create a new annotation to mark a deployment, experiment, or notable event.

- `content` (required): Text of the annotation
- `date_marker` (required): ISO 8601 timestamp for the annotation
- `scope` (optional, default `"project"`): `"project"` or `"dashboard"`

---

### Surveys

#### `posthog_list_surveys`
List surveys configured in the project.

- `limit` (optional, default 20)

---

### Event Capture

#### `posthog_capture_event`
Capture a custom event into PostHog (server-side event tracking).

- `distinct_id` (required): User's distinct ID
- `event` (required): Event name
- `properties` (optional): Key-value properties
- `timestamp` (optional): ISO 8601 timestamp (defaults to now)

---

## API Rate Limits

PostHog enforces the following limits on analytics endpoints:
- **240 requests/minute**
- **1,200 requests/hour**

The integration respects these limits and caps paginated fetches at 10 pages per call.

## Development

### Build
```bash
pnpm install
pnpm build
```

### Test via CLI
```bash
# Get spec
node bin/index.js spec

# Get tools
node bin/index.js get-tools --config '{"api_key":"phx_xxx","host":"https://app.posthog.com","project_id":"1234"}'

# Call a tool
node bin/index.js call-tool \
  --config '{"api_key":"phx_xxx","host":"https://app.posthog.com","project_id":"1234"}' \
  --tool-name "posthog_list_feature_flags" \
  --tool-arguments '{"active_only":true}'
```

## License

MIT
