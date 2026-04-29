import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Logo } from "../src/components/logo";
import { loginWithDeviceCode } from "../src/lib/auth";
import { useAuth } from "../src/lib/auth-context";
import { useTheme } from "../src/theme";

export default function Login() {
  const router = useRouter();
  const auth = useAuth();
  const theme = useTheme();
  const [status, setStatus] = useState<"idle" | "waiting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status === "signed-in") router.replace("/(tabs)/voice");
  }, [auth.status, router]);

  const handleLogin = async () => {
    setStatus("waiting");
    setError(null);
    try {
      await loginWithDeviceCode();
      await auth.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  const { colors, fontFamily, fontSize, radius, space } = theme;
  const waiting = status === "waiting";

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.background, padding: space.xl },
      ]}
    >
      <View style={[styles.card, { gap: space.md }]}>
        <View style={styles.logoWrap}>
          <Logo size={60} />
        </View>

        <Text
          style={{
            fontFamily: fontFamily.sans,
            fontSize: fontSize.xl,
            color: colors.foreground,
            textAlign: "center",
            fontWeight: "400",
          }}
        >
          Welcome to CORE
        </Text>

        <Text
          style={{
            fontFamily: fontFamily.sans,
            fontSize: fontSize.sm,
            color: colors.mutedForeground,
            textAlign: "center",
            lineHeight: 20,
          }}
        >
          By connecting a third-party account, you agree to our{" "}
          <Text
            style={{ textDecorationLine: "underline" }}
            onPress={() => Linking.openURL("https://getcore.me/terms")}
          >
            Terms of Service
          </Text>{" "}
          and{" "}
          <Text
            style={{ textDecorationLine: "underline" }}
            onPress={() => Linking.openURL("https://getcore.me/privacy")}
          >
            Privacy Policy
          </Text>
        </Text>

        {error ? (
          <Text
            style={{
              fontFamily: fontFamily.sans,
              fontSize: fontSize.sm,
              color: colors.destructive,
              textAlign: "center",
            }}
          >
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={handleLogin}
          disabled={waiting}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: pressed
                ? colors.grayAlpha200
                : colors.grayAlpha100,
              borderRadius: radius.lg,
              opacity: waiting ? 0.7 : 1,
            },
          ]}
        >
          {waiting ? (
            <ActivityIndicator color={colors.foreground} />
          ) : (
            <Text
              style={{
                fontFamily: fontFamily.sans,
                fontSize: fontSize.base,
                color: colors.foreground,
              }}
            >
              Get started
            </Text>
          )}
        </Pressable>

        {waiting ? (
          <Text
            style={{
              fontFamily: fontFamily.sans,
              fontSize: fontSize.xs,
              color: colors.mutedForeground,
              textAlign: "center",
            }}
          >
            Complete sign-in in the browser that just opened.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { width: "100%", maxWidth: 350, padding: 12 },
  logoWrap: { alignItems: "center", marginBottom: 8 },
  button: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
