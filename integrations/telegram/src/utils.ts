import axios, { AxiosInstance } from 'axios';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export interface TelegramConfig {
  bot_token: string;
  bot_id?: string;
  bot_username?: string;
}

/**
 * Create an authenticated Telegram Bot API client
 */
export function getTelegramClient(botToken: string): AxiosInstance {
  return axios.create({
    baseURL: `${TELEGRAM_API_BASE}/bot${botToken}`,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Call a Telegram Bot API method
 */
export async function callTelegramApi(
  botToken: string,
  method: string,
  params?: Record<string, any>
): Promise<any> {
  const client = getTelegramClient(botToken);
  const response = await client.post(`/${method}`, params || {});

  if (!response.data.ok) {
    throw new Error(`Telegram API error: ${response.data.description}`);
  }

  return response.data.result;
}

/**
 * Format a Telegram user for display
 */
export function formatUser(user: any): string {
  const parts = [];
  if (user.first_name) parts.push(user.first_name);
  if (user.last_name) parts.push(user.last_name);
  if (user.username) parts.push(`(@${user.username})`);
  return parts.join(' ') || `User ${user.id}`;
}

/**
 * Format a Telegram chat for display
 */
export function formatChat(chat: any): string {
  if (chat.title) return chat.title;
  return formatUser(chat);
}
