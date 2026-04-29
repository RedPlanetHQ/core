import * as SecureStore from "expo-secure-store";

const PAT_KEY = "core.pat";

export async function getPat(): Promise<string | null> {
  return SecureStore.getItemAsync(PAT_KEY);
}

export async function setPat(token: string): Promise<void> {
  await SecureStore.setItemAsync(PAT_KEY, token);
}

export async function clearPat(): Promise<void> {
  await SecureStore.deleteItemAsync(PAT_KEY);
}
