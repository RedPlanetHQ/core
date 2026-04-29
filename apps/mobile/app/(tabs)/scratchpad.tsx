import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "../../src/components/avatar";
import { DayEditor, type DayEditorHandle } from "../../src/components/day-editor";
import { EditorToolbar } from "../../src/components/editor-toolbar";
import { WeekStrip } from "../../src/components/week-strip";
import { formatDateHeader, startOfToday } from "../../src/lib/dates";
import { useAuth } from "../../src/lib/auth-context";
import { useTheme } from "../../src/theme";

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default function ScratchpadTab() {
  const theme = useTheme();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Date>(() => startOfToday());
  const [editorFocused, setEditorFocused] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const editorRef = useRef<DayEditorHandle | null>(null);

  // Track keyboard so the editor area can shrink to leave room for the
  // toolbar above the keyboard. WebView keyboard events still fire here
  // because we're listening at the JS bridge level.
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Bottom inset for the editor: clear the floating tab bar (when no
  // keyboard) or clear the keyboard + toolbar (when keyboard is up).
  const tabBarReserve = Math.max(insets.bottom, 12) + 8 + 72 + 8; // safe + gap + height + gap
  const keyboardReserve = keyboardHeight + 56; // keyboard + floating toolbar
  const editorBottomInset =
    keyboardHeight > 0 ? keyboardReserve : tabBarReserve;

  const monthLabel = `${MONTHS_LONG[selected.getMonth()]} ${selected.getFullYear()}`;
  const me = auth.status === "signed-in" ? auth.me : null;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top"]}
    >
      {/* Top bar: avatar (left) + centred month/year title */}
      <View style={[styles.topBar, { paddingHorizontal: theme.space.lg }]}>
        <Avatar name={me?.name ?? null} email={me?.email ?? null} size={32} />
        <Text
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: theme.fontFamily.sansSemibold,
            fontSize: 17,
            color: theme.colors.foreground,
          }}
        >
          {monthLabel}
        </Text>
      </View>

      <View style={{ paddingHorizontal: theme.space.lg, paddingTop: 8 }}>
        <WeekStrip selected={selected} onSelect={setSelected} />
      </View>

      <View style={{ paddingHorizontal: theme.space.lg, paddingTop: theme.space.xl, paddingBottom: 4 }}>
        <Text
          style={{
            fontFamily: theme.fontFamily.sansSemibold,
            fontSize: 24,
            color: theme.colors.foreground,
          }}
        >
          {formatDateHeader(selected)}
        </Text>
      </View>

      {/* Editor fills the space between the chrome above and the floating
          tab bar / keyboard below. The editor's own WebView handles scroll. */}
      <View style={{ flex: 1, paddingBottom: editorBottomInset }}>
        <DayEditor
          ref={editorRef}
          date={selected}
          onFocusChange={setEditorFocused}
        />
      </View>

      {editorFocused ? (
        <EditorToolbar
          onCommand={(cmd) => editorRef.current?.runCommand(cmd)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
});
