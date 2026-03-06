/**
 * Galaxia OS Bot - Multi-Agent Telegram Bridge for CORE
 *
 * Each Telegram chat can use a different AI agent. Agents are defined in agents.json.
 * Each agent has its own personality, skills, and CORE API connection.
 *
 * Commands:
 *   /start   - Welcome message + agent selection
 *   /agent   - Switch agent in current chat
 *   /new     - Start fresh conversation (keep same agent)
 *   /agents  - List all available agents
 *
 * Config: agents.json (copy from agents.example.json)
 * Env: TELEGRAM_BOT_TOKEN, CORE_API_URL (optional, default http://localhost:3033)
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// --- Types ---

interface AgentConfig {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  coreApiToken: string;
}

interface AgentsFile {
  agents: AgentConfig[];
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; first_name?: string; username?: string; type: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
  };
}

interface ChatState {
  agentId: string;
  conversationId: string;
}

// --- Config ---

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CORE_API_URL = (process.env.CORE_API_URL || "http://localhost:3033").replace(/\/$/, "");
const MAX_MSG_LEN = 4096;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required. Get it from @BotFather on Telegram.");
  process.exit(1);
}

// Load agents config
function loadAgents(): AgentConfig[] {
  const configPath = resolve(process.cwd(), "agents.json");
  if (!existsSync(configPath)) {
    console.error("agents.json not found. Copy agents.example.json to agents.json and configure your agents.");
    process.exit(1);
  }

  const raw = readFileSync(configPath, "utf-8");
  const config: AgentsFile = JSON.parse(raw);

  if (!config.agents || config.agents.length === 0) {
    console.error("No agents defined in agents.json");
    process.exit(1);
  }

  for (const agent of config.agents) {
    if (!agent.id || !agent.name || !agent.coreApiToken) {
      console.error(`Agent "${agent.id || agent.name || "unknown"}" is missing required fields (id, name, coreApiToken)`);
      process.exit(1);
    }
    if (agent.coreApiToken.includes("HIER") || agent.coreApiToken.includes("HERE")) {
      console.warn(`Warning: Agent "${agent.name}" has a placeholder API token.`);
    }
  }

  return config.agents;
}

const agents = loadAgents();
const agentMap = new Map(agents.map((a) => [a.id, a]));

// --- State ---

const chatStates = new Map<number, ChatState>();
const processingMessages = new Set<number>();

// --- Telegram API ---

async function tg(method: string, body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram ${method}: ${res.status} ${text}`);
  }

  return res.json();
}

async function sendMessage(chatId: number, text: string, extra?: Record<string, unknown>): Promise<void> {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MSG_LEN) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n", MAX_MSG_LEN);
    if (splitIdx < MAX_MSG_LEN * 0.5) splitIdx = remaining.lastIndexOf(" ", MAX_MSG_LEN);
    if (splitIdx < MAX_MSG_LEN * 0.3) splitIdx = MAX_MSG_LEN;

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  for (const chunk of chunks) {
    await tg("sendMessage", { chat_id: chatId, text: chunk, parse_mode: "Markdown", ...extra }).catch(async () => {
      await tg("sendMessage", { chat_id: chatId, text: chunk, ...extra });
    });
  }
}

async function sendTyping(chatId: number): Promise<void> {
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}

// --- Agent Selection ---

function buildAgentKeyboard() {
  return {
    inline_keyboard: agents.map((a) => [
      { text: `${a.emoji} ${a.name} - ${a.description}`, callback_data: `agent:${a.id}` },
    ]),
  };
}

function getAgent(chatId: number): AgentConfig | undefined {
  const state = chatStates.get(chatId);
  if (!state) return undefined;
  return agentMap.get(state.agentId);
}

function setAgent(chatId: number, agentId: string): void {
  chatStates.set(chatId, {
    agentId,
    conversationId: `tg-${chatId}-${agentId}-${Date.now()}`,
  });
}

// --- CORE API ---

async function callCoreAPI(chatId: number, message: string, agent: AgentConfig): Promise<string> {
  const state = chatStates.get(chatId)!;

  // Inject agent personality as context for the first message in conversation
  const enrichedMessage = agent.systemPrompt
    ? `<agent-persona>\n${agent.systemPrompt}\n\nIMPORTANT: You ARE ${agent.name}. Stay in character. Use ALL your capabilities (memory, integrations, web search, reminders) to give the best possible answer. Be proactive - search before saying you don't know.\n</agent-persona>\n\n${message}`
    : message;

  const res = await fetch(`${CORE_API_URL}/api/v1/conversation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agent.coreApiToken}`,
    },
    body: JSON.stringify({
      id: state.conversationId,
      message: {
        id: `tg-${Date.now()}`,
        parts: [{ type: "text", text: enrichedMessage }],
        role: "user",
      },
      source: "telegram",
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`CORE API error (agent: ${agent.name}): ${res.status} ${errorText}`);
    throw new Error(`CORE API returned ${res.status}`);
  }

  const data = await res.json();
  return data.message?.parts?.[0]?.text || "Keine Antwort erhalten.";
}

// --- Message Handling ---

async function handleCallbackQuery(query: TelegramUpdate["callback_query"]): Promise<void> {
  if (!query?.data || !query.message) return;

  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("agent:")) {
    const agentId = data.slice(6);
    const agent = agentMap.get(agentId);

    if (!agent) {
      await tg("answerCallbackQuery", { callback_query_id: query.id, text: "Agent nicht gefunden" });
      return;
    }

    setAgent(chatId, agentId);

    await tg("editMessageText", {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: `${agent.emoji} *${agent.name}* ist jetzt aktiv!\n\n_${agent.description}_\n\nSchreib einfach los.`,
      parse_mode: "Markdown",
    }).catch(() => {});

    await tg("answerCallbackQuery", { callback_query_id: query.id, text: `${agent.name} aktiviert!` });
  }
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const text = msg.text.trim();

  if (processingMessages.has(messageId)) return;
  processingMessages.add(messageId);

  try {
    // --- Commands ---

    if (text === "/start") {
      if (agents.length === 1) {
        setAgent(chatId, agents[0].id);
        await sendMessage(chatId, `Hey! ${agents[0].emoji} *${agents[0].name}* ist bereit.\n\n_${agents[0].description}_\n\nSchreib einfach los!`);
      } else {
        await sendMessage(chatId, `Hey! Wähl deinen Agenten:`, { reply_markup: buildAgentKeyboard() });
      }
      return;
    }

    if (text === "/agent" || text === "/agents") {
      const current = getAgent(chatId);
      const header = current
        ? `Aktuell: ${current.emoji} *${current.name}*\n\nWechseln zu:`
        : `Wähl deinen Agenten:`;
      await sendMessage(chatId, header, { reply_markup: buildAgentKeyboard() });
      return;
    }

    if (text === "/new") {
      const agent = getAgent(chatId);
      if (agent) {
        setAgent(chatId, agent.id);
        await sendMessage(chatId, `Neue Konversation mit ${agent.emoji} ${agent.name} gestartet.`);
      } else {
        await sendMessage(chatId, `Wähl erstmal einen Agenten:`, { reply_markup: buildAgentKeyboard() });
      }
      return;
    }

    // --- Regular message ---

    let agent = getAgent(chatId);
    if (!agent) {
      if (agents.length === 1) {
        setAgent(chatId, agents[0].id);
        agent = agents[0];
      } else {
        await sendMessage(chatId, `Wähl erstmal einen Agenten:`, { reply_markup: buildAgentKeyboard() });
        return;
      }
    }

    await sendTyping(chatId);
    const typingInterval = setInterval(() => sendTyping(chatId), 4000);

    try {
      const response = await callCoreAPI(chatId, text, agent);
      clearInterval(typingInterval);
      await sendMessage(chatId, response);
    } catch (error: any) {
      clearInterval(typingInterval);
      console.error(`[${agent.name}] Error for chat ${chatId}:`, error.message);
      await sendMessage(chatId, `Da ist was schiefgelaufen. Versuch's nochmal oder /new für eine neue Konversation.`);
    }
  } finally {
    processingMessages.delete(messageId);
  }
}

// --- Main ---

async function main(): Promise<void> {
  let offset = 0;

  console.log("=== Galaxia OS Bot - Multi-Agent Telegram Bridge ===");
  console.log(`CORE API: ${CORE_API_URL}`);
  console.log(`Agents: ${agents.map((a) => `${a.emoji} ${a.name}`).join(", ")}`);

  try {
    const me = await tg("getMe");
    console.log(`Bot: @${me.result.username} (${me.result.first_name})`);
  } catch (error: any) {
    console.error("Telegram Bot Token ungültig:", error.message);
    process.exit(1);
  }

  await tg("setMyCommands", {
    commands: [
      { command: "start", description: "Bot starten" },
      { command: "agent", description: "Agent wechseln" },
      { command: "agents", description: "Alle Agenten anzeigen" },
      { command: "new", description: "Neue Konversation" },
    ],
  }).catch(() => {});

  console.log("Polling gestartet...\n");

  while (true) {
    try {
      const response = await tg("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });

      if (response.ok && response.result.length > 0) {
        for (const update of response.result) {
          offset = update.update_id + 1;
          handleUpdate(update).catch((err) => console.error("Unhandled error:", err));
        }
      }
    } catch (error: any) {
      console.error("Polling error:", error.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main();
