import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import { Animated, AppState, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConversationPill } from "@/components/ConversationPill";
import { FlickerGrid } from "@/components/FlickerGrid";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { streamVoiceTurn } from "@/lib/api";
import { SttSession } from "@/lib/stt";
import { clearToken, getConversationId } from "@/lib/storage";
import { speakSentence, stopSpeaking, whenIdle } from "@/lib/tts";

type Status = "idle" | "listening" | "thinking" | "speaking";

const SENTENCE_BOUNDARY = /[.!?](\s+|$)/;

const STATUS_LABEL: Record<Status, string> = {
  idle: "tap to speak",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
};

type Props = {
  token: string;
  onLogout: () => void;
};

export function VoiceScreen({ token, onLogout }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sttRef = useRef<SttSession | null>(null);
  const abortStreamRef = useRef<(() => void) | null>(null);
  const ttsBufferRef = useRef("");
  const ttsConsumedRef = useRef(0);
  const dotPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return () => {
      sttRef.current?.destroy();
      abortStreamRef.current?.();
      void stopSpeaking();
    };
  }, []);

  // Deep-link handler for the iOS Shortcut / AppIntent. Opens via
  // `core://voice-start` and auto-starts a listening session.
  useEffect(() => {
    const maybeStart = (url: string | null) => {
      if (url && url.includes("voice-start") && status === "idle") {
        void startListening();
      }
    };
    Linking.getInitialURL().then(maybeStart);
    const sub = Linking.addEventListener("url", ({ url }) => maybeStart(url));
    return () => sub.remove();
    // intentional: only wire once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status-dot pulse animation while a turn is in flight.
  useEffect(() => {
    if (status === "idle") {
      dotPulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(dotPulse, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status, dotPulse]);

  // Background → foreground: stop in-flight TTS so the user isn't surprised by
  // audio resuming when they switch back to the app.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") void stopSpeaking();
    });
    return () => sub.remove();
  }, []);

  async function startListening() {
    setError(null);
    setTranscript("");
    setReply("");
    ttsBufferRef.current = "";
    ttsConsumedRef.current = 0;
    await stopSpeaking();

    const stt = new SttSession({
      onPartial: (text) => setTranscript(text),
      onFinal: (text) => {
        setTranscript(text);
        void submitTurn(text);
      },
      onError: (err) => {
        setError(err.message);
        setStatus("idle");
      },
    });
    sttRef.current = stt;

    try {
      await stt.start("en-US");
      setStatus("listening");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("idle");
    }
  }

  async function stopListening() {
    await sttRef.current?.stop();
  }

  async function submitTurn(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      setStatus("idle");
      return;
    }
    setStatus("thinking");

    const conversationId = await getConversationId();
    abortStreamRef.current = streamVoiceTurn(
      token,
      { transcript: trimmed, conversationId, mode: "voice" },
      {
        onDelta: handleDelta,
        onError: (err) => {
          setError(err.message);
          setStatus("idle");
        },
        onDone: () => {
          flushTailTts();
        },
      },
    );
  }

  function handleDelta(delta: string) {
    setStatus((s) => (s === "thinking" ? "speaking" : s));
    setReply((prev) => prev + delta);
    ttsBufferRef.current += delta;

    while (true) {
      const remaining = ttsBufferRef.current.slice(ttsConsumedRef.current);
      const match = remaining.match(SENTENCE_BOUNDARY);
      if (!match || match.index === undefined) break;
      const cut = match.index + match[0].length;
      const sentence = remaining.slice(0, cut).trim();
      ttsConsumedRef.current += cut;
      if (sentence) speakSentence(token, sentence);
    }
  }

  function flushTailTts() {
    const tail = ttsBufferRef.current.slice(ttsConsumedRef.current).trim();
    ttsConsumedRef.current = ttsBufferRef.current.length;
    if (tail) speakSentence(token, tail);
    whenIdle(() => setStatus("idle"));
  }

  function handleGridPress() {
    if (status === "idle") void startListening();
    else if (status === "listening") void stopListening();
  }

  async function handleLogout() {
    abortStreamRef.current?.();
    await sttRef.current?.destroy();
    await stopSpeaking();
    await clearToken();
    onLogout();
  }

  const active = status !== "idle";
  const dotOpacity = dotPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-2 pb-1">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <View
            className={active ? "bg-primary" : "bg-muted-foreground"}
            style={{ width: 6, height: 6, borderRadius: 3 }}
          />
          <Text className="font-mono text-xs tracking-widest text-muted-foreground">
            CORE
          </Text>
        </View>
        <Button variant="ghost" size="sm" onPress={handleLogout}>
          <Text className="text-muted-foreground text-xs">Log out</Text>
        </Button>
      </View>

      {/* Body */}
      <View className="flex-1 px-5 justify-between">
        {/* Top: user pill */}
        <View className="mt-4" style={{ minHeight: 56 }}>
          {transcript ? <ConversationPill role="user" text={transcript} /> : null}
        </View>

        {/* Center: grid + status */}
        <View className="items-center">
          <Pressable
            onPress={handleGridPress}
            accessibilityLabel="Toggle listening"
            className="active:opacity-80"
          >
            <FlickerGrid active={active} />
          </Pressable>

          <View
            className="flex-row items-center mt-6"
            style={{ gap: 8 }}
          >
            <Animated.View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: active ? "#1F88F5" : "#898989",
                opacity: active ? dotOpacity : 1,
              }}
            />
            <Text className="font-mono text-xs tracking-wider text-muted-foreground lowercase">
              {STATUS_LABEL[status]}
            </Text>
          </View>

          {error ? (
            <Text className="text-destructive text-xs mt-2 font-mono">
              {error}
            </Text>
          ) : null}
        </View>

        {/* Bottom: assistant pill */}
        <View className="mb-4" style={{ minHeight: 80 }}>
          {reply ? <ConversationPill role="assistant" text={reply} /> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
