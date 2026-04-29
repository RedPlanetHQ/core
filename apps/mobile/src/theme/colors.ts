// Mirrors apps/webapp/app/tailwind.css design tokens. RN can't read CSS
// variables, so we materialise the palette to hex/rgba here. Keep these
// values aligned with tailwind.css when the webapp theme changes.

export type ColorScheme = "light" | "dark";

type Palette = {
  background: string;
  background2: string;
  background3: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  borderDark: string;
  input: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  warning: string;
  // Gray scale
  gray50: string;
  gray100: string;
  gray200: string;
  gray300: string;
  gray400: string;
  gray500: string;
  gray600: string;
  gray700: string;
  gray800: string;
  gray900: string;
  gray950: string;
  grayAlpha100: string;
  grayAlpha200: string;
  grayAlpha300: string;
  grayAlpha500: string;
};

const light: Palette = {
  background: "#EFEFEF",
  background2: "#F7F7F7",
  background3: "#FFFFFF",
  foreground: "#3A3A3A",
  mutedForeground: "#838383",
  border: "#E0E0E0",
  borderDark: "rgba(0,0,0,0.39)",
  input: "rgba(0,0,0,0.063)",
  primary: "#0381E9",
  primaryForeground: "#FFFFFF",
  destructive: "#D75056",
  destructiveForeground: "#FFFFFF",
  success: "#3CAF20",
  warning: "#C28C11",
  gray50: "#F9F9F9",
  gray100: "#EFEFEF",
  gray200: "#E8E8E8",
  gray300: "#E0E0E0",
  gray400: "#CECECE",
  gray500: "#D8D8D8",
  gray600: "#BBBBBB",
  gray700: "#8D8D8D",
  gray800: "#838383",
  gray900: "#646464",
  gray950: "#202020",
  grayAlpha100: "rgba(0,0,0,0.063)",
  grayAlpha200: "rgba(0,0,0,0.090)",
  grayAlpha300: "rgba(0,0,0,0.122)",
  grayAlpha500: "rgba(0,0,0,0.192)",
};

const dark: Palette = {
  background: "#222222",
  background2: "#2A2A2A",
  background3: "#313131",
  foreground: "#D8D8D8",
  mutedForeground: "#B4B4B4",
  border: "#3A3A3A",
  borderDark: "rgba(255,255,255,0.39)",
  input: "rgba(255,255,255,0.106)",
  primary: "#0381E9",
  primaryForeground: "#EEEEEE",
  destructive: "#D75056",
  destructiveForeground: "#FFFFFF",
  success: "#5D9151",
  warning: "#C28C11",
  gray50: "#191919",
  gray100: "#222222",
  gray200: "#2A2A2A",
  gray300: "#313131",
  gray400: "#3A3A3A",
  gray500: "#484848",
  gray600: "#606060",
  gray700: "#6E6E6E",
  gray800: "#7B7B7B",
  gray900: "#B4B4B4",
  gray950: "#EEEEEE",
  grayAlpha100: "rgba(255,255,255,0.071)",
  grayAlpha200: "rgba(255,255,255,0.106)",
  grayAlpha300: "rgba(255,255,255,0.133)",
  grayAlpha500: "rgba(255,255,255,0.231)",
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };
export type { Palette };
