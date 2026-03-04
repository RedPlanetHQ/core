import axios from 'axios';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  messages: ChatMessage[];
  lastActive: number;
}

interface AIProvider {
  name: string;
  apiBase: string;
  apiKey: string;
  model: string;
  maxTokensKey: string; // 'max_tokens' for both, but Anthropic also needs other fields
}

const MAX_HISTORY = 30;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

const sessions = new Map<number, ChatSession>();

const SYSTEM_PROMPT = `Du bist M0Claw, Maurice's persoenlicher AI-Agent und System-Controller.
Du bist der beste Agent im Team und hast volle Kontrolle ueber alle Systeme.
Du antwortest auf Deutsch, es sei denn der User schreibt auf einer anderen Sprache.
Du bist direkt, kompakt und effektiv. Kein unnuetiges Gelaber.

Deine Faehigkeiten:
- System-Kontrolle: Server, Services, Monitoring
- Agent-Management: Agents steuern, koordinieren, Tasks delegieren
- Code & Technik: Programmierung, DevOps, Automation
- Content & Marketing: Social Media, Promo-Posts, Trends
- Revenue Tracking: Einnahmen verfolgen, Ziele setzen

Du bist wie ein CLI-Chat: Der User gibt dir Befehle und du fuehrst sie aus.
Wenn der User "starte X" oder "mach Y" sagt, fuehre es aus oder erklaere was zu tun ist.
Du hast Zugriff auf Ollama (GLM4), alle Agents (Monica, Dwight, Kelly, Ryan, Chandler, Ross).
Halte Antworten kurz wenn moeglich, ausfuehrlich wenn noetig.`;

const PROMO_SYSTEM_PROMPT = `Du bist M0Claw, ein Content-Creator-Assistent.
Deine Aufgabe: Aus dem gegebenen Inhalt einen fertigen Promo-Post erstellen.

Regeln:
- Schreibe einen knackigen, aufmerksamkeitsstarken Post
- Passend für Social Media (Twitter/X, Instagram, LinkedIn — je nach Kontext)
- Nutze den Kern-Inhalt, nicht 1:1 kopieren
- Baue einen eigenen Spin/Mehrwert ein
- Halte es kurz: max 280 Zeichen für X, etwas länger für andere Plattformen
- Füge passende Hashtags hinzu (2-4)
- Wenn es ein Thread sein soll, nummeriere die Teile
- Schreibe auf Deutsch, es sei denn der Originalinhalt ist auf Englisch
- Gib NUR den fertigen Post-Text aus, keine Erklärungen drumrum`;

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
  return { messageCount: Math.max(0, session.messages.length - 1), active: true };
}

/**
 * Detect which AI provider is available
 */
function detectProvider(): AIProvider | null {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const ollamaBase = process.env.OLLAMA_BASE_URL;
  const model = process.env.AI_MODEL;

  // Ollama (local, free, no API key needed)
  if (ollamaBase) {
    return {
      name: 'ollama',
      apiBase: ollamaBase,
      apiKey: 'ollama',
      model: model ?? 'llama3.2',
      maxTokensKey: 'max_tokens',
    };
  }

  // OpenAI
  if (openaiKey) {
    const base = process.env.AI_API_BASE ?? 'https://api.openai.com/v1';
    return {
      name: 'openai',
      apiBase: base,
      apiKey: openaiKey,
      model: model ?? 'gpt-4.1-mini',
      maxTokensKey: 'max_tokens',
    };
  }

  // Anthropic
  if (anthropicKey) {
    const base = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
    return {
      name: 'anthropic',
      apiBase: base,
      apiKey: anthropicKey,
      model: model ?? 'claude-sonnet-4-20250514',
      maxTokensKey: 'max_tokens',
    };
  }

  return null;
}

/** Currently active provider name for /status */
export function getProviderName(): string {
  const p = detectProvider();
  if (!p) return 'keiner (kein API-Key)';
  return `${p.name} / ${p.model}`;
}

/**
 * Call Anthropic Messages API
 */
async function callAnthropic(provider: AIProvider, messages: ChatMessage[]): Promise<string> {
  // Anthropic wants system as a top-level param, not in messages
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const response = await axios.post(
    `${provider.apiBase}/v1/messages`,
    {
      model: provider.model,
      max_tokens: 2048,
      system,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    },
    {
      headers: {
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    },
  );

  const content = response.data.content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
  }

  return '';
}

/**
 * Call OpenAI-compatible Chat Completions API
 */
async function callOpenAI(provider: AIProvider, messages: ChatMessage[]): Promise<string> {
  const isLocal = provider.name === 'ollama';
  const response = await axios.post(
    `${provider.apiBase}/chat/completions`,
    {
      model: provider.model,
      messages,
      max_tokens: 2048,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: isLocal ? 120000 : 60000,
    },
  );

  return response.data.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * Send user message and get AI response
 */
export async function chat(chatId: number, userMessage: string): Promise<string> {
  const provider = detectProvider();

  if (!provider) {
    return [
      'AI-Chat nicht verfügbar.',
      '',
      'Setze in .env:',
      '  OLLAMA_BASE_URL=http://localhost:11434/v1 (kostenlos, lokal)',
      '  oder OPENAI_API_KEY=sk-...',
      '  oder ANTHROPIC_API_KEY=sk-ant-...',
    ].join('\n');
  }

  const session = getSession(chatId);
  session.messages.push({ role: 'user', content: userMessage });

  // Trim history if too long (keep system + last N messages)
  if (session.messages.length > MAX_HISTORY + 1) {
    const system = session.messages[0];
    session.messages = [system, ...session.messages.slice(-MAX_HISTORY)];
  }

  try {
    let reply: string;

    if (provider.name === 'anthropic') {
      reply = await callAnthropic(provider, session.messages);
    } else {
      // OpenAI and Ollama both use the OpenAI-compatible API
      reply = await callOpenAI(provider, session.messages);
    }

    if (!reply) {
      return 'Keine Antwort vom AI-Modell erhalten.';
    }

    session.messages.push({ role: 'assistant', content: reply });
    return reply;
  } catch (err: any) {
    const status = err.response?.status;
    const errMsg = err.response?.data?.error?.message ?? err.message;

    console.error(`[AI/${provider.name}] Error (${status}): ${errMsg}`);

    if (status === 401) return `API-Key ungültig. Bitte ${provider.name === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} prüfen.`;
    if (status === 429) return 'Rate Limit erreicht — bitte kurz warten.';
    if (status === 503) return 'AI-Service gerade nicht erreichbar — bitte gleich nochmal.';

    return `AI-Fehler (${provider.name}): ${errMsg}`;
  }
}

/**
 * Generate a promo post from scraped content.
 * Uses a dedicated system prompt for content creation.
 * Optional feedback for revisions.
 */
export async function generatePromo(scrapedContent: string, feedback?: string): Promise<string> {
  const provider = detectProvider();

  if (!provider) {
    return 'AI nicht verfügbar — kann keinen Promo erstellen. Bitte API-Key konfigurieren.';
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: PROMO_SYSTEM_PROMPT },
    { role: 'user', content: `Erstelle einen Promo-Post basierend auf diesem Inhalt:\n\n${scrapedContent}` },
  ];

  if (feedback) {
    messages.push(
      { role: 'assistant', content: '[vorheriger Entwurf wurde abgelehnt]' },
      { role: 'user', content: `Überarbeite den Promo-Post mit diesem Feedback: ${feedback}` },
    );
  }

  try {
    let reply: string;

    if (provider.name === 'anthropic') {
      reply = await callAnthropic(provider, messages);
    } else {
      reply = await callOpenAI(provider, messages);
    }

    return reply || 'Konnte keinen Promo-Post generieren.';
  } catch (err: any) {
    const errMsg = err.response?.data?.error?.message ?? err.message;
    console.error(`[AI/Promo] Error: ${errMsg}`);
    return `Fehler bei Promo-Erstellung: ${errMsg}`;
  }
}
