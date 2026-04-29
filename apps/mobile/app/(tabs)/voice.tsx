import { Text, View } from "react-native";

import { Screen } from "../../src/components/screen";
import { useAuth } from "../../src/lib/auth-context";
import { useTheme } from "../../src/theme";

export default function VoiceTab() {
  const { colors, fontFamily, fontSize, space } = useTheme();
  const auth = useAuth();
  const greeting =
    auth.status === "signed-in"
      ? `Hi${auth.me.name ? ` ${auth.me.name}` : ""}.`
      : "Hi.";

  return (
    <Screen title="Voice">
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: space.xl,
          gap: space.md,
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.sansSemibold,
            fontSize: fontSize.xxl,
            color: colors.foreground,
          }}
        >
          {greeting}
        </Text>
        <Text
          style={{
            fontFamily: fontFamily.sans,
            fontSize: fontSize.base,
            color: colors.mutedForeground,
            textAlign: "center",
          }}
        >
          Tap to talk to your butler. (Coming next.)
        </Text>
      </View>
    </Screen>
  );
}
