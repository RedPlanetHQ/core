/**
 * Galaxia OS Bot - Telegram Bridge for CORE
 *
 * A lightweight Telegram bot that forwards messages to CORE's conversation API
 * and returns responses. Replaces the old litellm+Ollama setup.
 *
 * Required environment variables:
 *   TELEGRAM_BOT_TOKEN  - Your Telegram bot token from @BotFather
 *   CORE_API_URL        - URL to your CORE instance (default: http://localhost:3033)
 *   CORE_API_TOKEN      - API token from CORE (generate in Settings > API Tokens)
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CORE_API_URL = (process.env.CORE_API_URL || "http://localhost:3033").replace(/\/$/, "");
const CORE_API_TOKEN = process.env.CORE_API_TOKEN;
const POLL_INTERVAL_MS = 1000;
const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required. Get it from @BotFather on Telegram.");
  process.exit(1);
}

if (!CORE_API_TOKEN) {
  console.error("CORE_API_TOKEN is required. Generate one in CORE Settings > API Tokens.");
  process.exit(1);
}

// Track conversation IDs per Telegram chat
const chatConversations = new Map<number, string>();

// Track ongoing requests to prevent duplicate processing
const processingMessages = new Set<number>();

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; first_name?: string; username?: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    date: number;
  };
}

interface TelegramResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

async function telegramAPI(method: string, body?: Record<string, unknown>): Promise<any> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram API error (${method}): ${res.status} ${text}`);
  }

  return res.json();
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  // Split long messages at Telegram's 4096 char limit
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline near the limit
    let splitIdx = remaining.lastIndexOf("\n", MAX_TELEGRAM_MESSAGE_LENGTH);
    if (splitIdx < MAX_TELEGRAM_MESSAGE_LENGTH * 0.5) {
      // If no good newline, split at space
      splitIdx = remaining.lastIndexOf(" ", MAX_TELEGRAM_MESSAGE_LENGTH);
    }
    if (splitIdx < MAX_TELEGRAM_MESSAGE_LENGTH * 0.3) {
      // If still no good split point, just cut
      splitIdx = MAX_TELEGRAM_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  for (const chunk of chunks) {
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: "Markdown",
    }).catch(async () => {
      // If Markdown fails, retry without parse_mode
      await telegramAPI("sendMessage", {
        chat_id: chatId,
        text: chunk,
      });
    });
  }
}

async function sendTypingAction(chatId: number): Promise<void> {
  await telegramAPI("sendChatAction", {
    chat_id: chatId,
    action: "typing",
  }).catch(() => {});
}

async function callCoreAPI(chatId: number, message: string): Promise<string> {
  // Get or create conversation ID for this chat
  let conversationId = chatConversations.get(chatId);
  if (!conversationId) {
    conversationId = `telegram-${chatId}-${Date.now()}`;
    chatConversations.set(chatId, conversationId);
  }

  const res = await fetch(`${CORE_API_URL}/api/v1/conversation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CORE_API_TOKEN}`,
    },
    body: JSON.stringify({
      id: conversationId,
      message: {
        id: `tg-${Date.now()}`,
        parts: [{ type: "text", text: message }],
        role: "user",
      },
      source: "telegram",
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`CORE API error: ${res.status} ${errorText}`);
    throw new Error(`CORE API returned ${res.status}`);
  }

  const data = await res.json();
  return data.message?.parts?.[0]?.text || "Keine Antwort erhalten.";
}

async function handleMessage(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const text = msg.text.trim();

  // Prevent duplicate processing
  if (processingMessages.has(messageId)) return;
  processingMessages.add(messageId);

  try {
    // Handle /start command
    if (text === "/start") {
      await sendTelegramMessage(
        chatId,
        "Hey! Ich bin dein CORE Agent. Schreib mir einfach was du wissen willst."
      );
      return;
    }

    // Handle /new command - start new conversation
    if (text === "/new") {
      chatConversations.delete(chatId);
      await sendTelegramMessage(chatId, "Neue Konversation gestartet.");
      return;
    }

    // Show typing indicator
    await sendTypingAction(chatId);

    // Keep sending typing indicator while waiting for response
    const typingInterval = setInterval(() => sendTypingAction(chatId), 4000);

    try {
      const response = await callCoreAPI(chatId, text);
      clearInterval(typingInterval);
      await sendTelegramMessage(chatId, response);
    } catch (error: any) {
      clearInterval(typingInterval);
      console.error(`Error processing message from chat ${chatId}:`, error.message);
      await sendTelegramMessage(
        chatId,
        "Da ist was schiefgelaufen. Versuch's nochmal oder starte eine neue Konversation mit /new"
      );
    }
  } finally {
    processingMessages.delete(messageId);
  }
}

async function pollUpdates(): Promise<void> {
  let offset = 0;

  console.log("Galaxia OS Bot gestartet - Telegram Bridge für CORE");
  console.log(`CORE API: ${CORE_API_URL}`);

  // Verify bot token works
  try {
    const me = await telegramAPI("getMe");
    console.log(`Bot: @${me.result.username} (${me.result.first_name})`);
  } catch (error: any) {
    console.error("Telegram Bot Token ungültig:", error.message);
    process.exit(1);
  }

  // Set bot commands
  await telegramAPI("setMyCommands", {
    commands: [
      { command: "start", description: "Bot starten" },
      { command: "new", description: "Neue Konversation starten" },
    ],
  }).catch(() => {});

  while (true) {
    try {
      const response: TelegramResponse = await telegramAPI("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message"],
      });

      if (response.ok && response.result.length > 0) {
        for (const update of response.result) {
          offset = update.update_id + 1;
          // Process messages concurrently
          handleMessage(update).catch((err) =>
            console.error("Unhandled message error:", err)
          );
        }
      }
    } catch (error: any) {
      console.error("Polling error:", error.message);
      // Wait before retrying on error
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// Start polling
pollUpdates();
