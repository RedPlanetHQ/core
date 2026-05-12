import { setAudioModeAsync } from "expo-audio";

/**
 * Configure the iOS audio session for half-duplex voice conversation.
 *
 * `playAndRecord` + `voiceChat` (mode set via expo-speech-recognition's
 * iosCategory when listening) activates iOS's voice-processing IO unit,
 * which applies hardware echo cancellation: the mic stops hearing the
 * speaker's own output. Without this, TTS bleeds into the mic and shows
 * up as garbage tokens in the next STT pass.
 *
 * Safe to call once at app startup; iOS keeps the session active.
 */
export async function configureAudioSession(): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    // expo-audio may not be linked in dev or pre-prebuild; ignore.
  }
}
