import axios from 'axios';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  messages: ChatMessage[];
  lastActive: number;
}

const MAX_HISTORY = 30;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

const sessions = new Map<number, ChatSession>();

const SYSTEM_PROMPT = `Du bist M0Claw, ein hilfreicher AI-Assistent auf Telegram.
Du antwortest auf Deutsch, es sei denn der User schreibt auf einer anderen Sprache.
Du bist direkt, kompakt und hilfreich. Kein unnötiges Gelaber.
Du kannst über alles reden — Code, Technik, Alltag, Ideen, Projekte.
Halte Antworten kurz wenn möglich, ausführlich wenn nötig.`;

function getSession(chatId: number): ChatSession {
  let session = sessions.get(chatId);

  if (!session || Date.now() - session.lastActive > SESSION_TIMEOUT_MS) {
    session = {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }],
      lastActive: Date.now(),
    };
    sessions.set(chatId, session);
  }

  session.lastActive = Date.now();
  return session;
}

export function clearSession(chatId: number) {
  sessions.delete(chatId);
}

export function getSessionInfo(chatId: number): { messageCount: number; active: boolean } {
  const session = sessions.get(chatId);
  if (!session) return { messageCount: 0, active: false };
  // -1 for system message
  return { messageCount: Math.max(0, session.messages.length - 1), active: true };
}

/**
 * Send user message and get AI response via OpenAI-compatible API
 */
export async function chat(chatId: number, userMessage: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const apiBase = process.env.AI_API_BASE ?? 'https://api.openai.com/v1';
  const model = process.env.AI_MODEL ?? 'gpt-4.1-mini';

  if (!apiKey) {
    return 'AI-Chat nicht verfügbar — OPENAI_API_KEY fehlt in .env';
  }

  const session = getSession(chatId);

  session.messages.push({ role: 'user', content: userMessage });

  // Trim history if too long (keep system + last N messages)
  if (session.messages.length > MAX_HISTORY + 1) {
    const system = session.messages[0];
    session.messages = [system, ...session.messages.slice(-(MAX_HISTORY))];
  }

  try {
    const response = await axios.post(
      `${apiBase}/chat/completions`,
      {
        model,
        messages: session.messages,
        max_tokens: 2048,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );

    const reply = response.data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return 'Keine Antwort vom AI-Modell erhalten.';
    }

    session.messages.push({ role: 'assistant', content: reply });
    return reply;
  } catch (err: any) {
    const status = err.response?.status;
    const errMsg = err.response?.data?.error?.message ?? err.message;

    console.error(`[AI] Error (${status}): ${errMsg}`);

    if (status === 401) return 'API-Key ungültig. Bitte OPENAI_API_KEY prüfen.';
    if (status === 429) return 'Rate Limit erreicht — bitte kurz warten.';
    if (status === 503) return 'AI-Service gerade nicht erreichbar — bitte gleich nochmal.';

    return `AI-Fehler: ${errMsg}`;
  }
}
