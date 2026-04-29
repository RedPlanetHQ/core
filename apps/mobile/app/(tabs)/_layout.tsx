import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { FloatingTabBar } from "../../src/components/floating-tab-bar";
import { useAuth } from "../../src/lib/auth-context";
import { useTheme } from "../../src/theme";

export default function TabsLayout() {
  const auth = useAuth();
  const theme = useTheme();

  if (auth.status === "loading") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.background,
        }}
      >
        <ActivityIndicator color={theme.colors.foreground} />
      </View>
    );
  }
  if (auth.status === "signed-out") return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tabs.Screen name="voice" options={{ title: "Voice" }} />
      <Tabs.Screen name="scratchpad" options={{ title: "Scratchpad" }} />
      <Tabs.Screen name="chat" options={{ title: "Chat" }} />
    </Tabs>
  );
}
