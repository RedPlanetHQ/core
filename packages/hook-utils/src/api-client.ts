import { getTimeout, HOOK_TIMEOUTS } from "./cli";

const API_BASE_URL = "https://app.getcore.me/api/v1";

export interface AddEpisodePayload {
  episodeBody: string;
  referenceTime: string;
  source: string;
  type: string;
  sessionId: string;
}

export interface DocumentResponse {
  document: {
    id: string;
    title: string;
    content?: string;
    ingestionQueueCount?: number;
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * Add episode/conversation to CORE
 * @param payload Episode data to add
 * @param token Authentication token
 * @returns True if successful, false otherwise
 */
export async function addEpisode(payload: AddEpisodePayload, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/add`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(getTimeout(HOOK_TIMEOUTS.DEFAULT)),
    });

    if (!response.ok) {
      console.error(`Failed to add episode: HTTP ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      `Error adding episode: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

/**
 * Fetch user persona from /api/v1/me
 * @param token Authentication token
 * @returns User persona string or null
 */
export async function fetchUserPersona(token: string): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(getTimeout(HOOK_TIMEOUTS.DEFAULT)),
    });

    if (!response.ok) {
      console.error(`Failed to fetch user persona: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { persona?: string };
    return data.persona || "";
  } catch (error) {
    console.error(
      `Error fetching user persona: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}
