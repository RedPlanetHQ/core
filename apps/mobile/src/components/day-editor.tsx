import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import { API_URL } from "../lib/config";
import { getPageForDate, type Page } from "../lib/pages";
import { getPat } from "../lib/storage";
import { useTheme } from "../theme";
import type { EditorCommand } from "./editor-toolbar";

export type DayEditorHandle = {
  runCommand: (command: EditorCommand) => void;
};

// Renders the existing webapp PageEditor via the chromeless
// `/embed/scratchpad/:pageId` route — full Tiptap + Yjs + Hocuspocus +
// every custom extension. The WebView handles its own scrolling so iOS'
// native cursor-follow works while typing (Apple Notes style).
export const DayEditor = forwardRef<
  DayEditorHandle,
  {
    date: Date;
    onFocusChange?: (focused: boolean) => void;
  }
>(function DayEditor({ date, onFocusChange }, ref) {
  const theme = useTheme();
  const [page, setPage] = useState<Page | null>(null);
  const [pat, setPatState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const webRef = useRef<WebView | null>(null);

  useImperativeHandle(ref, () => ({
    runCommand(command) {
      const wv = webRef.current;
      if (!wv) return;
      const payload = JSON.stringify({ type: "core-editor", command });
      wv.injectJavaScript(`
        (function() {
          try {
            window.dispatchEvent(new MessageEvent('message', { data: ${payload} }));
          } catch (e) {}
          true;
        })();
      `);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    setError(null);

    Promise.all([getPageForDate(date), getPat()])
      .then(([p, token]) => {
        if (cancelled) return;
        setPage(p);
        setPatState(token);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load page");
      });

    return () => {
      cancelled = true;
    };
  }, [date]);

  if (error) {
    return <View style={[styles.root, { flex: 1 }]} />;
  }

  if (!page || !pat) {
    return (
      <View style={[styles.root, styles.center, { flex: 1 }]}>
        <ActivityIndicator color={theme.colors.mutedForeground} />
      </View>
    );
  }

  const url = `${API_URL}/embed/scratchpad/${page.id}?token=${encodeURIComponent(pat)}`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <WebView
        ref={webRef}
        source={{ uri: url }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        // The WebView owns its scroll — that's what gives us iOS' native
        // cursor-follow behaviour while typing.
        scrollEnabled
        scalesPageToFit={false}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        contentInsetAdjustmentBehavior="automatic"
        // Hide iOS' default ^ v Done accessory bar — we render our own
        // toolbar above the keyboard from RN.
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        bounces
        allowsLinkPreview={false}
        onMessage={(event) => {
          try {
            const msg = JSON.parse(event.nativeEvent.data);
            if (msg?.type === "core-editor-focus" && onFocusChange) {
              onFocusChange(Boolean(msg.focused));
            }
          } catch {
            // Ignore non-JSON messages.
          }
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { backgroundColor: "transparent" },
  center: { alignItems: "center", justifyContent: "center" },
});
