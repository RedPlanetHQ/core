/**
 * In-app dictation: hold Ctrl+Shift while a text input is focused, the
 * Swift recognizer transcribes, and on release the transcript is
 * inserted at the caret. While dictating, a top-center pill mirrors
 * the look of the butler voice widget and shows the live partial.
 *
 * Modifier-only chord — any non-modifier keypress during the hold
 * aborts and lets the underlying shortcut through.
 */

import { useEffect, useRef, useState } from "react";
import { Theme, useTheme } from "remix-themes";

import { FlickeringGrid } from "~/components/ui/flickering-grid";
import { isTauri, tauriInvoke, tauriListen } from "~/lib/tauri.client";

// How long Ctrl+Shift must be held alone before we start dictation.
// Filters out incidental chords like Ctrl+Shift+Tab.
const HOLD_DELAY_MS = 200;

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

// Input types that make sense for dictation. password and number-like
// inputs are intentionally excluded.
const TEXTUAL_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "",
]);

type DictationStatus = "idle" | "armed" | "listening" | "inserting";

function getEditableActive(): EditableTarget | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return null;
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return null;
    if (!TEXTUAL_INPUT_TYPES.has(el.type.toLowerCase())) return null;
    return el;
  }
  if (el instanceof HTMLTextAreaElement) {
    if (el.disabled || el.readOnly) return null;
    return el;
  }
  if (el.isContentEditable) return el;
  return null;
}

function insertAtCaret(el: EditableTarget, text: string) {
  if (!text) return;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newValue = el.value.slice(0, start) + text + el.value.slice(end);

    // React's controlled inputs only react when the value goes through
    // the prototype's setter (it monkey-patches that to detect external
    // writes). Plain assignment is silently overwritten on next render.
    const proto =
      el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(el, newValue);
    } else {
      el.value = newValue;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));

    const caret = start + text.length;
    el.setSelectionRange(caret, caret);
    return;
  }

  el.focus();
  if (document.execCommand("insertText", false, text)) return;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
}

export function DictationOverlay() {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [partial, setPartial] = useState("");
  const [theme] = useTheme();
  const isDark = theme === Theme.DARK;

  const targetRef = useRef<EditableTarget | null>(null);
  const activeRef = useRef(false);
  const armRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (!isTauri() || typeof window === "undefined") return;

    function clearArm() {
      if (armRef.current) {
        clearTimeout(armRef.current);
        armRef.current = null;
      }
    }

    function teardownListeners() {
      const list = unsubsRef.current;
      unsubsRef.current = [];
      list.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
    }

    async function start() {
      const target = getEditableActive();
      if (!target) return;
      targetRef.current = target;
      activeRef.current = true;
      setStatus("listening");
      setPartial("");

      try {
        const partialUnsub = await tauriListen<{ text: string }>(
          "dictation:partial",
          (event) => {
            setPartial(event.payload?.text ?? "");
          },
        );
        const finalUnsub = await tauriListen<{ text: string }>(
          "dictation:final",
          (event) => {
            const text = (event.payload?.text ?? "").trim();
            const tgt = targetRef.current;
            if (text && tgt) insertAtCaret(tgt, text);
            setStatus("idle");
            setPartial("");
            targetRef.current = null;
            // The flag in Rust auto-clears on final, so the listeners
            // won't fire again until the next dictation session.
            teardownListeners();
          },
        );
        const errorUnsub = await tauriListen<{ message: string }>(
          "dictation:error",
          () => {
            setStatus("idle");
            setPartial("");
            targetRef.current = null;
            teardownListeners();
          },
        );
        unsubsRef.current = [partialUnsub, finalUnsub, errorUnsub];

        await tauriInvoke("voice_start_dictation");
      } catch (err) {
        console.warn("[dictation] start failed", err);
        activeRef.current = false;
        targetRef.current = null;
        setStatus("idle");
        setPartial("");
        teardownListeners();
      }
    }

    async function stop() {
      if (!activeRef.current) return;
      activeRef.current = false;
      setStatus("inserting");
      try {
        await tauriInvoke("voice_stop_dictation");
      } catch (err) {
        console.warn("[dictation] stop failed", err);
        setStatus("idle");
        teardownListeners();
        return;
      }
      // The dictation:final handler will clear status/partial when
      // the trailing transcript arrives. Safety timeout in case the
      // helper never emits one.
      setTimeout(() => {
        setStatus((s) => (s === "inserting" ? "idle" : s));
        setPartial("");
        targetRef.current = null;
        teardownListeners();
      }, 3000);
    }

    async function cancel() {
      activeRef.current = false;
      targetRef.current = null;
      setStatus("idle");
      setPartial("");
      try {
        await tauriInvoke("voice_cancel_dictation");
      } catch (err) {
        console.warn("[dictation] cancel failed", err);
      }
      teardownListeners();
    }

    function onKeyDown(e: KeyboardEvent) {
      // Non-modifier keypress during arm or active dictation → abort.
      // The user meant a real shortcut.
      if (!["Control", "Shift", "Meta", "Alt"].includes(e.key)) {
        if (armRef.current) clearArm();
        if (activeRef.current) void cancel();
        return;
      }

      const onlyCtrlShift =
        e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
      if (!onlyCtrlShift) {
        clearArm();
        if (activeRef.current) void cancel();
        return;
      }

      if (armRef.current || activeRef.current) return;
      setStatus("armed");
      armRef.current = setTimeout(() => {
        armRef.current = null;
        if (!activeRef.current) {
          // armed but never started (e.g. focus moved off editable) —
          // reset the visible status.
          setStatus("idle");
        }
        void start();
      }, HOLD_DELAY_MS);
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Control" || e.key === "Shift") {
        if (armRef.current) {
          clearArm();
          setStatus("idle");
        }
        if (activeRef.current) void stop();
      }
    }

    function onBlur() {
      clearArm();
      if (activeRef.current) void cancel();
      else setStatus("idle");
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      clearArm();
      if (activeRef.current) void cancel();
      teardownListeners();
    };
  }, []);

  if (status === "idle") return null;

  const isListening = status === "listening";
  const stateLabel =
    status === "armed"
      ? "Ready"
      : status === "listening"
        ? "Listening…"
        : "Inserting…";

  const gridColor = isListening
    ? "rgb(var(--primary))"
    : isDark
      ? "oklch(85.8% 0 0)"
      : "oklch(30.87% 0 0)";

  const showPartial = isListening && partial.trim().length > 0;

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[100] flex flex-col items-end gap-1">
      <div className="border-border bg-background-3 text-muted-foreground pointer-events-auto flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium shadow-md">
        <div className="relative h-3.5 w-5 overflow-hidden rounded-sm">
          <FlickeringGrid
            width={20}
            height={14}
            squareSize={2}
            gridGap={2}
            flickerChance={isListening ? 0.8 : 0.3}
            maxOpacity={isListening ? 0.9 : 0.25}
            color={gridColor}
          />
        </div>
        {stateLabel}
      </div>
      {showPartial && (
        <div
          className="border-border bg-background-3 text-foreground max-w-[320px] rounded-lg border px-2.5 py-1.5 text-xs leading-snug shadow-md"
          aria-live="polite"
        >
          {partial}
        </div>
      )}
    </div>
  );
}
