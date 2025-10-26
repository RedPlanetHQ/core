# Telemetry in Core

Core collects anonymous usage data to help us understand how the product is being used and to make data-driven improvements. This document explains what we collect, why we collect it, and how to opt-out.

## Our Commitment to Privacy

We take your privacy seriously. Telemetry is designed to be:

- **Transparent**: You can see exactly what we collect (listed below)
- **Respectful**: Easy to disable at any time
- **Minimal**: We only collect what helps improve the product
- **Secure**: Data is transmitted securely to PostHog

## What We Collect

### User Information

- **Email address only**: Used to identify unique users (can be anonymized - see below)
- No other personal information is collected

### Feature Usage Events

We track when these features are used (event name only, no additional data):

- **episode_ingested**: When you add a conversation episode
- **document_ingested**: When you add a document
- **search_performed**: When you perform a search
- **deep_search_performed**: When you use deep search
- **conversation_created**: When you start a new AI conversation
- **conversation_message_sent**: When you send a message in a conversation
- **space_created**: When you create a new space
- **space_updated**: When you update a space
- **user_registered**: When a new user signs up

### System Configuration (Tracked Once at Startup)

- **Queue provider**: Whether you're using Trigger.dev or BullMQ
- **Model provider**: Which LLM you're using (OpenAI, Anthropic, Ollama, etc.)
- **Model name**: The specific model configured
- **Embedding model**: Which embedding model is configured
- **App environment**: Development, production, or test
- **Node environment**: Runtime environment

### Errors (Automatic)

- **Error type**: The type of error that occurred
- **Error message**: Brief description of the error
- **Error stack trace**: Technical details for debugging
- **Request context**: URL, method, user agent (for server errors)

### Page Views (Client-Side)

- **Page navigation**: Which pages are visited
- **Session information**: Basic session tracking

## What We DON'T Collect

We explicitly **do not** collect:

- ❌ **Your document content**: None of your ingested documents or notes
- ❌ **Space content**: Your space data remains private
- ❌ **Search queries**: We track that searches happen, not what you searched for
- ❌ **Conversation content**: We never collect the actual messages or responses
- ❌ **User names**: Only email addresses are collected (can be anonymized)
- ❌ **Workspace IDs**: Not tracked
- ❌ **Space IDs**: Not tracked
- ❌ **Conversation IDs**: Not tracked
- ❌ **API keys or secrets**: No sensitive credentials
- ❌ **IP addresses**: Not tracked
- ❌ **File paths or system details**: No filesystem information
- ❌ **Environment variables**: Configuration remains private

**Privacy-First Approach**: We only track the event name and user email. No metadata, no additional properties, no detailed analytics.

## Why We Collect This Data

### Product Improvement

- Understand which features are most valuable
- Identify features that need improvement
- Prioritize development based on actual usage

### Reliability & Performance

- Detect and fix errors before they affect many users
- Identify performance bottlenecks
- Monitor system health across different configurations

### Usage Patterns

- Understand how different deployment types (Docker, manual, cloud) are used
- See which queue providers and models are popular
- Make informed decisions about which integrations to prioritize

## How to Opt-Out

We respect your choice to disable telemetry. Here are several ways to control telemetry:

### Option 1: Disable Telemetry Completely

Add to your `.env` file:

```bash
TELEMETRY_ENABLED=false
```

### Option 2: Anonymous Mode

Keep telemetry enabled but send "anonymous" instead of your email:

```bash
TELEMETRY_ANONYMOUS=true
```

### Option 3: Remove PostHog Key

Set the PostHog key to empty:

```bash
POSTHOG_PROJECT_KEY=
```

After making any of these changes, restart your Core instance.

## Environment Variables

```bash
# PostHog project key
POSTHOG_PROJECT_KEY=phc_your_key_here

# Enable/disable telemetry (default: true)
TELEMETRY_ENABLED=true

# Send "anonymous" instead of email (default: false)
TELEMETRY_ANONYMOUS=false

# Industry standard opt-out
DO_NOT_TRACK=1
```

## For Self-Hosted Deployments

### Default Behavior

- Telemetry is **enabled by default** with opt-out
- Sends data to our PostHog instance
- Easy to disable (see options above)

### Using Your Own PostHog Instance

If you prefer to keep all data in-house, you can:

1. Deploy your own PostHog instance (https://posthog.com/docs/self-host)
2. Set `POSTHOG_PROJECT_KEY` to your self-hosted instance's key
3. All telemetry data stays on your infrastructure

### Completely Disable Telemetry

For maximum privacy in self-hosted deployments:

1. Set `TELEMETRY_ENABLED=false` in your `.env`
2. Or set `DO_NOT_TRACK=1`
3. No telemetry data will be sent

### Anonymous Mode

If you want to contribute usage data without identifying yourself:

1. Set `TELEMETRY_ANONYMOUS=true` in your `.env`
2. All events will be tracked as "anonymous" instead of your email
3. Helps us improve the product while maintaining your privacy

## Transparency

### Open Source

Core's telemetry code is completely open source. You can inspect exactly what is being tracked:

**Server-Side Tracking:**

- `apps/webapp/app/services/telemetry.server.ts` - Core telemetry service
- `apps/webapp/app/entry.server.tsx` - Global error tracking
- `apps/webapp/app/lib/ingest.server.ts:66,76` - Episode/document ingestion
- `apps/webapp/app/routes/api.v1.search.tsx:57` - Search tracking
- `apps/webapp/app/routes/api.v1.deep-search.tsx:33` - Deep search tracking
- `apps/webapp/app/services/conversation.server.ts:60,110` - Conversation tracking
- `apps/webapp/app/services/space.server.ts:68,201` - Space tracking
- `apps/webapp/app/models/user.server.ts:80,175` - User registration tracking
- `apps/webapp/app/utils/startup.ts:78` - System config tracking (once at startup)

**Client-Side Tracking:**

- `apps/webapp/app/hooks/usePostHog.ts` - Page views and user identification
- `apps/webapp/app/root.tsx:118-119` - PostHog initialization

### PostHog Key Security

- The PostHog project key (`phc_*`) is safe to expose publicly
- It can only **send** events, not read existing data
- This is standard practice for client-side analytics

### Data Minimization

Our approach prioritizes minimal data collection:

- **Event name only**: Just the feature name (e.g., "search_performed")
- **Email only**: Single identifier (can be anonymized)
- **No metadata**: No counts, times, IDs, or other properties
- **Config once**: System configuration tracked only at startup, not per-event

## Questions?

If you have questions about telemetry:

- Open an issue on GitHub: https://github.com/redplanethq/core/issues
- Review the source code to see exactly what's tracked
- Check PostHog's privacy policy: https://posthog.com/privacy

## Summary

**What we track**: Event names + email (e.g., "search_performed" by "user@example.com")
**What we don't track**: Content, queries, messages, IDs, counts, times, or any metadata
**How to opt-out**: `TELEMETRY_ENABLED=false` or `DO_NOT_TRACK=1`
**Anonymous mode**: `TELEMETRY_ANONYMOUS=true` (sends "anonymous" instead of email)
**Default**: Enabled with easy opt-out

### Events Tracked

| Event                       | Location                            | When It Fires                    |
| --------------------------- | ----------------------------------- | -------------------------------- |
| `episode_ingested`          | lib/ingest.server.ts:76             | Conversation episode added       |
| `document_ingested`         | lib/ingest.server.ts:66             | Document added                   |
| `search_performed`          | routes/api.v1.search.tsx:57         | Basic search executed            |
| `deep_search_performed`     | routes/api.v1.deep-search.tsx:33    | Deep search executed             |
| `conversation_created`      | services/conversation.server.ts:110 | New conversation started         |
| `conversation_message_sent` | services/conversation.server.ts:60  | Message sent in conversation     |
| `space_created`             | services/space.server.ts:68         | New space created                |
| `space_updated`             | services/space.server.ts:201        | Space updated                    |
| `user_registered`           | models/user.server.ts:80,175        | New user signs up                |
| `error_occurred`            | entry.server.tsx:36                 | Server error (auto-tracked)      |
| `system_config`             | utils/startup.ts:78                 | App starts (config tracked once) |

We believe in building in public and being transparent about data collection. Thank you for helping make Core better!
