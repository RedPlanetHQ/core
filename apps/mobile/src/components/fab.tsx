import { Pressable, StyleSheet, Text } from "react-native";
import { Plus } from "lucide-react-native";

import { useTheme } from "../theme";

export function Fab({
  onPress,
  bottom = 96,
  right = 20,
  label,
}: {
  onPress: () => void;
  bottom?: number;
  right?: number;
  label?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        {
          bottom,
          right,
          backgroundColor: theme.colors.primary,
          opacity: pressed ? 0.85 : 1,
          shadowColor: "#000",
        },
      ]}
    >
      {label ? (
        <Text
          style={{
            color: theme.colors.primaryForeground,
            fontFamily: theme.fontFamily.sansSemibold,
            fontSize: 14,
          }}
        >
          {label}
        </Text>
      ) : (
        <Plus color={theme.colors.primaryForeground} size={26} strokeWidth={2.4} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 6,
  },
});
