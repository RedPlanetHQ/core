import { useColorScheme } from "react-native";

import { palettes, type ColorScheme, type Palette } from "./colors";

// Mirrors --text-* tokens at the mobile breakpoint (max-width: 768px) since
// the phone always falls under that media query.
export const fontSize = {
  xs: 13,
  sm: 14,
  base: 16,
  md: 17,
  lg: 19,
  xl: 24,
  xxl: 28,
} as const;

// Mirrors --radius-* tokens.
export const radius = {
  none: 0,
  sm: 2,
  md: 6,
  lg: 8,
  xl: 12,
  xxl: 16,
  full: 9999,
} as const;

// 4-pt spacing scale, matching the tailwind defaults the webapp uses.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// Geist Variable is the webapp's primary font; we register it under the
// names below in _layout.tsx via expo-font.
export const fontFamily = {
  sans: "Geist",
  sansMedium: "Geist-Medium",
  sansSemibold: "Geist-SemiBold",
  mono: "GeistMono",
} as const;

export type Theme = {
  scheme: ColorScheme;
  colors: Palette;
  fontSize: typeof fontSize;
  radius: typeof radius;
  space: typeof space;
  fontFamily: typeof fontFamily;
};

export function useTheme(): Theme {
  const scheme = (useColorScheme() ?? "light") as ColorScheme;
  return {
    scheme,
    colors: palettes[scheme],
    fontSize,
    radius,
    space,
    fontFamily,
  };
}

export type { ColorScheme, Palette } from "./colors";
