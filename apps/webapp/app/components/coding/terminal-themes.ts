import type { ITheme } from "@xterm/xterm";

// xterm.js uses its own CSS color parser which doesn't support oklch.
// All colors are pre-converted hex equivalents of the app's oklch palette.
//
// ANSI colors follow oklch(60% 0.13 <hue>) for dark and oklch(46% 0.16 <hue>)
// for light (deeper chroma + lower lightness for legibility on light bg).
// Brights are one lightness step up: oklch(70% 0.13 <hue>).

export const terminalThemes: Record<"dark" | "light", ITheme> = {
  dark: {
    // oklch(21.34% 0 0), oklch(92.8% 0 0), oklch(31.32% 0 0)
    background: "#1e1e1e",
    foreground: "#e8e8e8",
    cursor: "#0880ea",
    cursorAccent: "#1e1e1e",
    selectionBackground: "#303030",
    selectionForeground: "#e8e8e8",

    // Grays — oklch(21.34% 0 0) → oklch(44% 0 0)
    black: "#1e1e1e",
    brightBlack: "#505050",

    // oklch(60% 0.13 30 / 70)
    red: "#bd5547",
    brightRed: "#e27966",

    // oklch(60% 0.13 150 / 70)
    green: "#32904d",
    brightGreen: "#52b16c",

    // oklch(60% 0.13 90 / 70)
    yellow: "#9b7600",
    brightYellow: "#b99529",

    // oklch(60% 0.13 240 / 70)
    blue: "#1a83c1",
    brightBlue: "#3ea3e7",

    // oklch(60% 0.13 300 / 70)
    magenta: "#8767be",
    brightMagenta: "#a885e4",

    // oklch(60% 0.13 210 / 70)
    cyan: "#008ea6",
    brightCyan: "#00aec8",

    // oklch(76.99% 0 0), oklch(92.8% 0 0)
    white: "#adadad",
    brightWhite: "#e8e8e8",
  },

  light: {
    // oklch(94.28% 0 0), oklch(18% 0 0)
    background: "#ececec",
    foreground: "#141414",
    cursor: "#0880ea",
    cursorAccent: "#ececec",
    // oklch(82% 0.05 252.59)
    selectionBackground: "#abc7e5",
    selectionForeground: "#141414",

    // Grays — near-black / dark-gray so dim-mode text stays readable
    // oklch(18% 0 0), oklch(42% 0 0)
    black: "#141414",
    brightBlack: "#484848",

    // oklch(46% 0.16 30 / 60% 0.13 30)
    red: "#982218",
    brightRed: "#bd5547",

    // oklch(46% 0.16 150 / 60% 0.13 150)
    green: "#00691d",
    brightGreen: "#32904d",

    // oklch(46% 0.16 90 / 60% 0.13 90)
    yellow: "#754600",
    brightYellow: "#9b7600",

    // oklch(46% 0.16 240 / 60% 0.13 240)
    blue: "#0054a2",
    brightBlue: "#1a83c1",

    // oklch(46% 0.16 300 / 60% 0.13 300)
    magenta: "#5d329c",
    brightMagenta: "#8767be",

    // oklch(46% 0.16 210 / 60% 0.13 210)
    cyan: "#006683",
    brightCyan: "#008ea6",

    // Must be DARK on a light bg — oklch(38% 0 0), oklch(18% 0 0)
    white: "#444444",
    brightWhite: "#141414",
  },
};
