// tinykeys ships type declarations at dist/tinykeys.d.ts but its package.json
// `exports` field hides them from TypeScript's resolver. We re-export at the
// shapes documented by the upstream types so call-sites stay strictly typed.

export interface KeyBindingMap {
  [keybinding: string]: (event: KeyboardEvent) => void;
}

export interface KeyBindingOptions {
  event?: "keydown" | "keyup";
  capture?: boolean;
  timeout?: number;
}

// @ts-expect-error – exports-field hides bundled types
import { tinykeys as tinykeysImpl } from "tinykeys";

export const tinykeys: (
  target: Window | HTMLElement,
  keyBindingMap: KeyBindingMap,
  options?: KeyBindingOptions,
) => () => void = tinykeysImpl;
