import { Pressable, Text, View } from "react-native";

import { Screen } from "../../src/components/screen";
import { useAuth } from "../../src/lib/auth-context";
import { useTheme } from "../../src/theme";

export default function ChatTab() {
  const { colors, fontFamily, fontSize, radius, space } = useTheme();
  const auth = useAuth();

  return (
    <Screen title="Chat">
      <View
        style={{
          flex: 1,
          padding: space.lg,
          gap: space.md,
        }}
      >
        <Text
          style={{
            fontFamily: fontFamily.sans,
            fontSize: fontSize.base,
            color: colors.mutedForeground,
          }}
        >
          Conversation thread (shared with voice) coming next.
        </Text>

        {auth.status === "signed-in" ? (
          <Pressable
            onPress={() => auth.signOut()}
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              paddingVertical: space.sm,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.background3 : "transparent",
            })}
          >
            <Text
              style={{
                fontFamily: fontFamily.sans,
                fontSize: fontSize.sm,
                color: colors.foreground,
              }}
            >
              Sign out
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}
