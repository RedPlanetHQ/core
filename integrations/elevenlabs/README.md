# ElevenLabs Integration

Connect ElevenLabs to CORE to track AI voice generation history, monitor your voice library, and surface TTS activity in your workspace timeline.

## Overview

The ElevenLabs integration uses your **API Key** to authenticate and syncs voice generation data on a schedule.

### What gets synced automatically

- **Generation history** — recent text-to-speech jobs (voice used, model, character count, text preview)
- **Voice library** — cloned or generated voices added to your account

## Authentication

1. Log in to [ElevenLabs](https://elevenlabs.io)
2. Click your profile avatar → **Profile**
3. Copy the **API Key** shown on the page
4. Paste it into CORE when connecting the integration

## Environment Variables

| Variable | Description |
|---|---|
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key |

## Development

### Build
```bash
pnpm install
pnpm build
```

### Test via CLI
```bash
# Get spec
node bin/index.cjs spec

# Run a sync
node bin/index.cjs sync \
  --config '{"api_key":"sk_your_key_here"}'
```

## License

MIT
