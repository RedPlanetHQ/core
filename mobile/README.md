# CORE Mobile

Single-screen iOS voice client for CORE. Sign in with the same authorization-code flow the Mac app uses, then tap a flickering grid to talk to your assistant.

Architecture mirrors `apps/tauri` + `apps/webapp`:
- **Auth**: `POST /api/v1/authorization-code` → open browser → poll `/api/v1/token` for the PAT, stored in iOS Keychain via `expo-secure-store`.
- **STT**: on-device `SFSpeechRecognizer` via `expo-speech-recognition` (same API as the bundled Swift helper in `apps/tauri/core-voice`).
- **LLM**: `POST /api/v1/voice-turn` over SSE, accumulating `text-delta` events.
- **TTS**: per-sentence POST to `/api/v1/voice-tts` (ElevenLabs proxy). On 200 → play MP3 stream via `expo-av`. On 204 (user prefers Apple, or no ElevenLabs key) → fall back to native `AVSpeechSynthesizer` via `expo-speech`. Provider choice is sticky for the session once known.
- **Theming**: NativeWind + react-native-reusables. CSS variables mirror `apps/webapp/app/tailwind.css`.

## Setup

This package lives **outside** the root pnpm workspace (see `pnpm-workspace.yaml`). Use plain `npm` or `yarn` inside this directory.

```bash
cd apps/mobile
npm install
cp .env.example .env   # edit if pointing at a non-prod backend
```

## Develop

The app uses native modules (`@react-native-voice/voice`), so Expo Go is not enough. Prebuild + run with a dev client:

```bash
npx expo prebuild --platform ios
npx expo run:ios --device   # plug in your iPhone
```

To iterate after the first build:

```bash
npm run ios
```

## Shipping to TestFlight

1. **Apple Developer account** — confirm enrollment.
2. **App Store Connect** → register bundle ID `me.getcore.app.mobile` and create the app listing (one icon + one screenshot is enough to start).
3. **Build** with EAS or Xcode:
   - EAS: `npx eas build --platform ios --profile production` (requires `eas.json`).
   - Xcode: open `ios/coremobile.xcworkspace`, Product → Archive → Distribute → App Store Connect.
4. **TestFlight** → invite testers via public link. First build takes ~24h for Apple review; subsequent builds in the same version are live in minutes.

## iOS Shortcuts integration

The app exposes a `StartVoiceIntent` `AppIntent` (see `plugins/StartVoiceIntent.swift`). Wiring:

- Swift file is injected into the generated `ios/` project by `plugins/with-voice-intent.js` (registered in `app.json` under `expo.plugins`). Survives `expo prebuild --clean`.
- The intent calls `core://voice-start`, which Expo Linking picks up in `VoiceScreen` and auto-starts a listening session.

**To use it, on your iPhone:**

1. Install + open the app at least once (so iOS registers the App Shortcut).
2. Open the **Shortcuts** app → the "Start CORE Voice" shortcut should appear under "App Shortcuts".
3. Assign it to:
   - **Action Button** (iPhone 15 Pro / 16 / 17): Settings → Action Button → Shortcut → "Start CORE Voice".
   - **Back Tap** (every iPhone 8+): Settings → Accessibility → Touch → Back Tap → Double Tap → "Start CORE Voice".
   - **"Hey Siri, talk to CORE"** — works out of the box once the shortcut is registered.
   - **Lock Screen / Control Center widget** (iOS 18+).

## Phase 2 ideas

- Bundle Geist as a custom font (`expo-font`) to match the webapp exactly.
- Wake word via Picovoice Porcupine (foreground only; iOS won't allow true background wake words).
- Upscale `assets/icon.png` from 512×512 → 1024×1024 for App Store / TestFlight submission.
