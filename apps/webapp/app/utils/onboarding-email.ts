/**
 * Derives the email domain from a LOGIN_ORIGIN URL.
 * Handles URLs with protocol and path; returns only the hostname.
 * Falls back to the raw string if URL parsing fails (e.g. already a bare hostname).
 */
export function deriveEmailDomain(loginOrigin: string): string {
  try {
    return new URL(loginOrigin).hostname;
  } catch {
    return loginOrigin;
  }
}

/**
 * Generates the email local-part (slug) for a butler email address.
 * Format: {butlerNameLower}_{userNameLowerNoSpaces}
 * Only alphanumeric characters are kept; anything else is dropped.
 */
export function generateButlerEmailSlug(
  butlerName: string,
  userName: string,
): string {
  const butlerPart = butlerName.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  const userPart = userName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!userPart) return butlerPart;
  if (!butlerPart) return userPart;
  return `${butlerPart}_${userPart}`;
}

/**
 * Generates the full butler email address.
 */
export function generateButlerEmail(
  butlerName: string,
  userName: string,
  domain: string,
): string {
  return `${generateButlerEmailSlug(butlerName, userName)}@${domain}`;
}
