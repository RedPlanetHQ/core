import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "core.pat";
const CONVERSATION_KEY = "core.conversationId";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(value: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, value);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getConversationId(): Promise<string | null> {
  return SecureStore.getItemAsync(CONVERSATION_KEY);
}

export async function setConversationId(value: string): Promise<void> {
  await SecureStore.setItemAsync(CONVERSATION_KEY, value);
}
