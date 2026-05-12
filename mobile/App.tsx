import "./global.css";

import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { configureAudioSession } from "@/lib/audio";
import { LoginScreen } from "@/screens/LoginScreen";
import { VoiceScreen } from "@/screens/VoiceScreen";
import { getToken } from "@/lib/storage";

type BootState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "authenticated"; token: string };

export default function App() {
  const [state, setState] = useState<BootState>({ kind: "loading" });

  useEffect(() => {
    (async () => {
      await configureAudioSession();
      const token = await getToken();
      setState(token ? { kind: "authenticated", token } : { kind: "unauthenticated" });
    })();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {state.kind === "loading" ? (
        <View className="flex-1 bg-background" />
      ) : state.kind === "authenticated" ? (
        <VoiceScreen
          token={state.token}
          onLogout={() => setState({ kind: "unauthenticated" })}
        />
      ) : (
        <LoginScreen
          onAuthenticated={(token) =>
            setState({ kind: "authenticated", token })
          }
        />
      )}
    </SafeAreaProvider>
  );
}
