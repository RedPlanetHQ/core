export const CORE_API_URL =
  process.env.EXPO_PUBLIC_CORE_API_URL?.replace(/\/$/, "") ??
  "https://app.getcore.me";
