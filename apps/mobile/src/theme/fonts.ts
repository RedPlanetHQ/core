import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
} from "@expo-google-fonts/geist";
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono";

// Map of (font name -> font module) consumed by expo-font.useFonts in
// _layout.tsx. The keys here must match the values in `fontFamily` so style
// references stay consistent.
export const fonts = {
  Geist: Geist_400Regular,
  "Geist-Medium": Geist_500Medium,
  "Geist-SemiBold": Geist_600SemiBold,
  GeistMono: GeistMono_400Regular,
};
