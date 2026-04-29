import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "../src/lib/auth-context";

export default function Index() {
  const auth = useAuth();

  if (auth.status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return auth.status === "signed-in" ? (
    <Redirect href="/(tabs)/voice" />
  ) : (
    <Redirect href="/login" />
  );
}
