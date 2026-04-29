import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Mic,
  NotebookPen,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react-native";

import { useTheme } from "../theme";

const ICONS: Record<string, LucideIcon> = {
  voice: Mic,
  scratchpad: NotebookPen,
  chat: MessagesSquare,
};

const LABELS: Record<string, string> = {
  voice: "Voice",
  scratchpad: "Scratchpad",
  chat: "Chat",
};

function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const a255 = Math.round(a * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a255}`;
}

// Floating capsule tab bar, detached from all four screen edges. Each
// tab claims an equal slice of the bar; the icon + label are centred
// inside that slice, and the active tab gets a primary-tint pill
// behind them.
export function FloatingTabBar({
  state,
  navigation,
}: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          bottom: Math.max(insets.bottom, 12) + 8,
          backgroundColor: theme.colors.background2,
          borderColor: theme.colors.border,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const Icon = ICONS[route.name];
        const label = LABELS[route.name] ?? route.name;

        return (
          <Pressable
            key={route.key}
            onPress={() => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name as never);
              }
            }}
            style={styles.slot}
            android_ripple={{
              color: withAlpha(theme.colors.foreground, 0.06),
              borderless: false,
            }}
          >
            <View
              style={[
                styles.pill,
                focused && {
                  backgroundColor: withAlpha(theme.colors.primary, 0.14),
                },
              ]}
            >
              {Icon ? (
                <Icon
                  size={22}
                  strokeWidth={2.2}
                  color={
                    focused
                      ? theme.colors.primary
                      : theme.colors.mutedForeground
                  }
                />
              ) : null}
              <Text
                numberOfLines={1}
                style={{
                  marginTop: 4,
                  fontFamily: theme.fontFamily.sansMedium,
                  fontSize: 11,
                  letterSpacing: 0.1,
                  color: focused
                    ? theme.colors.primary
                    : theme.colors.mutedForeground,
                }}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export const FLOATING_TAB_BAR_HEIGHT = 72;

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 16,
    right: 16,
    height: FLOATING_TAB_BAR_HEIGHT,
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 8,
    // @ts-expect-error – RN >=0.76 supports this on iOS
    borderCurve: "continuous",
  },
  slot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 80,
    // @ts-expect-error – RN >=0.76 supports this on iOS
    borderCurve: "continuous",
  },
});
