import { useEffect, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Bold,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Undo2,
  Redo2,
  type LucideIcon,
} from "lucide-react-native";

import { useTheme } from "../theme";
import { FLOATING_TAB_BAR_HEIGHT } from "./floating-tab-bar";

export type EditorCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "h1"
  | "h2"
  | "h3"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "code-block"
  | "undo"
  | "redo"
  | "slash";

const BUTTONS: Array<{
  command: EditorCommand;
  Icon?: LucideIcon;
  label?: string;
}> = [
  { command: "bold", Icon: Bold },
  { command: "italic", Icon: Italic },
  { command: "strike", Icon: Strikethrough },
  { command: "h1", Icon: Heading1 },
  { command: "h2", Icon: Heading2 },
  { command: "bullet-list", Icon: List },
  { command: "ordered-list", Icon: ListOrdered },
  { command: "task-list", Icon: CheckSquare },
  { command: "blockquote", Icon: Quote },
  { command: "code", Icon: Code },
  { command: "slash", label: "/" },
  { command: "undo", Icon: Undo2 },
  { command: "redo", Icon: Redo2 },
];

// Floating formatting toolbar — same capsule treatment as the tab bar.
// Sits just above the tab bar normally; rises above the keyboard when
// it shows. Caller controls visibility (we only render when the editor
// is focused).
export function EditorToolbar({
  onCommand,
}: {
  onCommand: (command: EditorCommand) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Position: above the keyboard when shown; otherwise just above the
  // floating tab bar. The +8 is the same gap the tab bar uses below it.
  const tabBarBottom = Math.max(insets.bottom, 12) + 8;
  const bottom =
    keyboardHeight > 0
      ? keyboardHeight + 8
      : tabBarBottom + FLOATING_TAB_BAR_HEIGHT + 8;

  return (
    <View
      style={[
        styles.bar,
        {
          bottom,
          backgroundColor: theme.colors.background2,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="always"
      >
        {BUTTONS.map(({ command, Icon, label }) => (
          <Pressable
            key={command}
            onPress={() => onCommand(command)}
            style={({ pressed }) => [
              styles.btn,
              {
                backgroundColor: pressed
                  ? theme.colors.grayAlpha200
                  : "transparent",
              },
            ]}
            hitSlop={4}
          >
            {Icon ? (
              <Icon color={theme.colors.foreground} size={20} strokeWidth={2} />
            ) : (
              <Text
                style={{
                  fontFamily: theme.fontFamily.sansSemibold,
                  fontSize: 17,
                  color: theme.colors.foreground,
                }}
              >
                {label}
              </Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 8,
    // @ts-expect-error – RN >=0.76 supports this on iOS
    borderCurve: "continuous",
  },
  row: {
    paddingHorizontal: 8,
    alignItems: "center",
    height: "100%",
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 2,
    // @ts-expect-error – RN >=0.76 supports this on iOS
    borderCurve: "continuous",
  },
});
