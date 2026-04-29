import { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../theme";

// Apple-style large title header. The title sits in the safe-area on
// background2 (the same surface as the body) so the header doesn't look
// like a bordered chrome strip — it's just the start of the page content.
// `scrollable` wraps children in a ScrollView; otherwise use a plain View
// (e.g. when the children manage their own list/virtualization).
export function Screen({
  title,
  subtitle,
  scrollable = false,
  children,
}: {
  title?: string;
  subtitle?: string;
  scrollable?: boolean;
  children: ReactNode;
}) {
  const { colors, fontFamily, fontSize, space } = useTheme();
  const insets = useSafeAreaInsets();

  const Header = title ? (
    <View
      style={{
        paddingHorizontal: space.lg,
        paddingTop: space.sm,
        paddingBottom: space.md,
      }}
    >
      <Text
        style={{
          fontFamily: fontFamily.sansSemibold,
          fontSize: 34, // iOS large-title size
          color: colors.foreground,
          letterSpacing: 0.36,
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            fontFamily: fontFamily.sans,
            fontSize: fontSize.sm,
            color: colors.mutedForeground,
            marginTop: 2,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  ) : null;

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      {scrollable ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
          {Header}
          {children}
        </ScrollView>
      ) : (
        <>
          {Header}
          <View style={styles.body}>{children}</View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
});
