import { Text, View, type ViewStyle } from "react-native";

import { useTheme } from "../theme";

// Mirrors the team-color palette from apps/webapp/app/tailwind.css
// (--team-color-1..14). Picking by stable hash means the same user gets
// the same colour every render and across sessions.
const TEAM_COLORS = [
  "#E194AD",
  "#E59593",
  "#E4997C",
  "#DDA068",
  "#D0A95D",
  "#BFB25F",
  "#AABA6C",
  "#93C180",
  "#7DC599",
  "#6BC6B3",
  "#62C4CC",
  "#67BFE1",
  "#77B8F0",
];

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function initialsFor(name: string | null | undefined, fallback: string): string {
  const source = (name ?? "").trim();
  if (!source) return fallback.slice(0, 1).toUpperCase();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({
  name,
  email,
  size = 32,
  style,
}: {
  name?: string | null;
  email?: string | null;
  size?: number;
  style?: ViewStyle;
}) {
  const { fontFamily } = useTheme();
  const seed = name || email || "core";
  const bg = TEAM_COLORS[hashString(seed) % TEAM_COLORS.length]!;
  const initials = initialsFor(name, email ?? "C");

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Text
        style={{
          color: "#FFFFFF",
          fontFamily: fontFamily.sansSemibold,
          fontSize: Math.round(size * 0.42),
          letterSpacing: 0.2,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}
