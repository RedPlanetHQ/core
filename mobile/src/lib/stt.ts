import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

export type SttHandlers = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (err: Error) => void;
};

type Subscription = { remove: () => void };

/**
 * Thin wrapper over expo-speech-recognition (iOS: SFSpeechRecognizer,
 * Android: SpeechRecognizer). Same on-device API the Tauri voice helper at
 * apps/tauri/core-voice uses — audio never leaves the device.
 *
 * Public API mirrors the previous @react-native-voice/voice wrapper so
 * VoiceScreen doesn't have to care which engine is underneath.
 */
export class SttSession {
  private handlers: SttHandlers;
  private subs: Subscription[] = [];
  private active = false;

  constructor(handlers: SttHandlers) {
    this.handlers = handlers;
  }

  async start(locale = "en-US"): Promise<void> {
    if (this.active) return;

    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      throw new Error("Speech recognition permission was not granted");
    }

    this.subs.push(
      ExpoSpeechRecognitionModule.addListener("result", (event) => {
        const transcript = event.results?.[0]?.transcript;
        if (!transcript) return;
        if (event.isFinal) this.handlers.onFinal(transcript);
        else this.handlers.onPartial(transcript);
      }),
      ExpoSpeechRecognitionModule.addListener("error", (event) => {
        const message =
          ("message" in event && typeof event.message === "string"
            ? event.message
            : undefined) ??
          ("error" in event && typeof event.error === "string"
            ? event.error
            : undefined) ??
          "speech error";
        this.handlers.onError(new Error(message));
      }),
      ExpoSpeechRecognitionModule.addListener("end", () => {
        this.active = false;
      }),
    );

    ExpoSpeechRecognitionModule.start({
      lang: locale,
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
      requiresOnDeviceRecognition: false,
      // playAndRecord + voiceChat enables hardware echo cancellation so the
      // mic stops picking up our own TTS output. See src/lib/audio.ts.
      iosCategory: {
        category: "playAndRecord",
        categoryOptions: [
          "defaultToSpeaker",
          "allowBluetooth",
          "allowBluetoothA2DP",
        ],
        mode: "voiceChat",
      },
    });
    this.active = true;
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      /* may already be stopped */
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
    for (const sub of this.subs) sub.remove();
    this.subs = [];
  }
}
