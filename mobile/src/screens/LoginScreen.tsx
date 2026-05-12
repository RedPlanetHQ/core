import { useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { loginAndAwaitPat } from "@/lib/auth";
import { setToken } from "@/lib/storage";

type Status = "idle" | "waiting" | "error";

type Props = {
  onAuthenticated: (token: string) => void;
};

export function LoginScreen({ onAuthenticated }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function handleSignIn() {
    setStatus("waiting");
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const pat = await loginAndAwaitPat(controller.signal);
      await setToken(pat);
      onAuthenticated(pat);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== "aborted") {
        setError(message);
        setStatus("error");
      } else {
        setStatus("idle");
      }
    } finally {
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center px-8">
        <View className="items-center" style={{ marginBottom: 48 }}>
          <Text className="text-2xl font-semibold tracking-tight">CORE</Text>
          <Text className="text-muted-foreground mt-2">
            Your voice assistant
          </Text>
        </View>

        {status === "waiting" ? (
          <View className="items-center" style={{ gap: 16 }}>
            <ActivityIndicator />
            <Text className="text-muted-foreground text-center">
              Waiting for approval in your browser…
            </Text>
            <Button variant="ghost" size="sm" onPress={handleCancel}>
              <Text>Cancel</Text>
            </Button>
          </View>
        ) : (
          <View className="w-full" style={{ gap: 12 }}>
            <Button onPress={handleSignIn}>
              <Text>Sign in to CORE</Text>
            </Button>
            {status === "error" && error ? (
              <Text className="text-destructive text-center text-sm">
                {error}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
