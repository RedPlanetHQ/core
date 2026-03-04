import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from same directory as this script
try {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {}

import { callTelegramApi, formatUser } from './utils';
import { extractMedia, downloadTelegramFile, extractUrls, classifyUrl, getStorageStats } from './media';
import { chat, clearSession, generatePromo } from './chat';
import { execSync } from 'child_process';

const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID ? Number(process.env.TELEGRAM_ADMIN_ID) : undefined;
const TARGET_CHANNEL = process.env.TELEGRAM_TARGET_CHANNEL || '';

// Store pending promos for approve/reject flow
const pendingPromos = new Map<string, { chatId: number; promo: string; url?: string }>();

async function sendTyping(botToken: string, chatId: number) {
  try {
    await callTelegramApi(botToken, 'sendChatAction', { chat_id: chatId, action: 'typing' });
  } catch (_) {}
}

async function handleMessage(botToken: string, message: any) {
  const chatId = message.chat.id;
  const text = (message.text ?? message.caption ?? '').trim();
  const from = message.from ? formatUser(message.from) : 'Unknown';
  const userId = message.from?.id;

  console.log(`[${new Date().toISOString()}] ${from}: ${text || '[media]'}`);

  // --- Commands ---
  if (text.startsWith('/')) {
    const handled = await handleCommand(botToken, chatId, text, userId);
    if (handled) return;
  }

  // --- Media handling ---
  const media = extractMedia(message);
  if (media) {
    await sendTyping(botToken, chatId);
    try {
      const localPath = await downloadTelegramFile(botToken, media.fileId, media.fileName, media.type);
      const sizeKB = media.fileSize ? (media.fileSize / 1024).toFixed(1) : '?';

      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `${mediaEmoji(media.type)} Gespeichert: ${media.fileName} (${sizeKB} KB)\n${localPath}`,
      });
    } catch (err: any) {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `Fehler beim Download: ${err.message}`,
      });
    }

    // Check caption for URLs → promo flow
    const urls = extractUrls(message);
    if (urls.length > 0) {
      await handlePromoFlow(botToken, chatId, urls, text);
    }
    return;
  }

  // --- URL handling → Promo Flow ---
  const urls = extractUrls(message);
  if (urls.length > 0) {
    await sendTyping(botToken, chatId);
    await handlePromoFlow(botToken, chatId, urls, text);
    return;
  }

  // --- Forwarded / Long text → Promo Flow ---
  if (message.forward_from || message.forward_from_chat) {
    if (text.length > 20) {
      await sendTyping(botToken, chatId);
      await handlePromoFlow(botToken, chatId, [], text);
      return;
    }
  }
  if (text.length > 100 && !text.endsWith('?')) {
    // Long text that's not a question → treat as content for promo
    await sendTyping(botToken, chatId);
    await handlePromoFlow(botToken, chatId, [], text);
    return;
  }

  // --- Contact ---
  if (message.contact) {
    const c = message.contact;
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `Kontakt: ${c.first_name} ${c.last_name ?? ''} ${c.phone_number ? `| Tel: ${c.phone_number}` : ''}`.trim(),
    });
    return;
  }

  // --- Location ---
  if (message.location) {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `Standort: ${message.location.latitude}, ${message.location.longitude}`,
    });
    return;
  }

  // --- AI Chat (default for all text) ---
  if (text) {
    await sendTyping(botToken, chatId);
    const reply = await chat(chatId, text);

    // Split long messages (Telegram limit: 4096 chars)
    const chunks = splitMessage(reply, 4000);
    for (const chunk of chunks) {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      }).catch(() => {
        // Fallback without markdown if parsing fails
        return callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: chunk,
        });
      });
    }
    return;
  }

  // Fallback
  await callTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: 'Nachricht empfangen.',
  });
}

async function handleCommand(botToken: string, chatId: number, text: string, userId?: number): Promise<boolean> {
  const cmd = text.split(' ')[0].toLowerCase();
  const args = text.slice(cmd.length).trim();

  switch (cmd) {
    case '/start':
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: [
          'M0Claw - Dein KI-Agent',
          '',
          'Schreib mir einfach - ich antworte mit KI.',
          'Links/Content → automatischer Promo-Post',
          '',
          '/clear - Chat zuruecksetzen',
          '/status - System-Status',
          '/models - Ollama Models',
          '/exec <cmd> - Shell Command',
          '/help - Alle Befehle',
        ].join('\n'),
      });
      return true;

    case '/clear':
      clearSession(chatId);
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: 'Chat-Verlauf geloescht.',
      });
      return true;

    case '/status': {
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const stats = getStorageStats();
      const model = process.env.AI_MODEL || 'openclaw-qwen3-8b:20k';
      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';

      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: [
          'M0Claw Status',
          `Uptime: ${h}h ${m}m`,
          `Model: ${model}`,
          `Ollama: ${ollamaUrl}`,
          `Dateien: ${stats.totalFiles} (${stats.totalSizeMB} MB)`,
          `Sessions: ${(globalThis as any).__sessions_count ?? 'N/A'}`,
        ].join('\n'),
      });
      return true;
    }

    case '/ping':
      await callTelegramApi(botToken, 'sendMessage', { chat_id: chatId, text: 'Pong!' });
      return true;

    case '/models': {
      try {
        const out = execSync('ollama list 2>/dev/null', { timeout: 10000 }).toString().trim();
        const lines = out.split('\n').slice(0, 15); // max 15 lines
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `Ollama Models:\n\n${lines.join('\n')}`,
        });
      } catch {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: 'Ollama nicht erreichbar.',
        });
      }
      return true;
    }

    case '/exec': {
      if (!args) {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: 'Usage: /exec <command>',
        });
        return true;
      }
      try {
        const out = execSync(args, { timeout: 30000, maxBuffer: 1024 * 1024 }).toString().trim();
        const result = out.substring(0, 3500) || '(keine Ausgabe)';
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `$ ${args}\n\n${result}`,
        });
      } catch (err: any) {
        const errMsg = (err.stderr?.toString() || err.message || 'Fehler').substring(0, 2000);
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `Fehler:\n${errMsg}`,
        });
      }
      return true;
    }

    case '/system': {
      try {
        const hostname = execSync('hostname').toString().trim();
        const diskRaw = execSync("df -h / | tail -1 | awk '{print $4}'").toString().trim();
        const memRaw = execSync("vm_stat | head -5").toString().trim();
        const ollamaRunning = execSync("pgrep -x ollama >/dev/null 2>&1 && echo 'running' || echo 'stopped'").toString().trim();

        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: [
            `System: ${hostname}`,
            `Disk frei: ${diskRaw}`,
            `Ollama: ${ollamaRunning}`,
          ].join('\n'),
        });
      } catch (err: any) {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `System-Info Fehler: ${err.message}`,
        });
      }
      return true;
    }

    case '/help':
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: [
          'M0Claw Befehle:',
          '',
          '/start - Willkommen',
          '/clear - Chat loeschen',
          '/status - Bot-Status',
          '/ping - Pong',
          '/models - Ollama Models',
          '/exec <cmd> - Shell ausfuehren',
          '/system - System-Info',
          '/help - Diese Hilfe',
          '',
          'Oder einfach schreiben - KI antwortet!',
          'Links → Promo-Post mit Freigabe',
        ].join('\n'),
      });
      return true;

    default:
      return false; // not a known command, pass to AI
  }
}

async function handlePromoFlow(botToken: string, chatId: number, urls: string[], content: string) {
  const url = urls[0]; // primary URL
  const sourceText = content || (url ? `Inhalt von: ${url}` : 'Content');

  // Generate promo
  const promo = await generatePromo(sourceText, url);
  const promoId = `promo_${Date.now()}_${chatId}`;

  pendingPromos.set(promoId, { chatId, promo, url });

  // Send with inline keyboard
  await callTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: `Promo-Vorschlag:\n\n${promo}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Freigeben', callback_data: `approve:${promoId}` },
          { text: 'Neu generieren', callback_data: `regen:${promoId}` },
        ],
        [
          { text: 'Bearbeiten', callback_data: `edit:${promoId}` },
          { text: 'Verwerfen', callback_data: `reject:${promoId}` },
        ],
      ],
    },
  });
}

async function handleCallbackQuery(botToken: string, callback: any) {
  const data = callback.data || '';
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;

  if (!chatId) return;

  const [action, promoId] = data.split(':');
  const pending = promoId ? pendingPromos.get(`${action === 'approve' || action === 'regen' || action === 'edit' || action === 'reject' ? '' : ''}${promoId}`) : undefined;

  // Re-construct key
  const fullKey = `${promoId}`;
  const promoData = pendingPromos.get(fullKey);

  // Acknowledge the callback
  await callTelegramApi(botToken, 'answerCallbackQuery', {
    callback_query_id: callback.id,
  }).catch(() => {});

  switch (action) {
    case 'approve': {
      if (!promoData) {
        await callTelegramApi(botToken, 'sendMessage', { chat_id: chatId, text: 'Promo nicht mehr verfuegbar.' });
        return;
      }

      if (TARGET_CHANNEL) {
        try {
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: TARGET_CHANNEL,
            text: promoData.promo,
            disable_web_page_preview: false,
          });
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: `Promo gepostet in Channel!`,
          });
        } catch (err: any) {
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: `Post-Fehler: ${err.message}\n\nPrüfe ob der Bot Admin im Channel ist.`,
          });
        }
      } else {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `Freigegeben! (Kein Ziel-Channel konfiguriert)\n\nSetze TELEGRAM_TARGET_CHANNEL in .env`,
        });
      }
      pendingPromos.delete(fullKey);
      break;
    }

    case 'regen': {
      if (!promoData) return;
      await sendTyping(botToken, chatId);
      const newPromo = await generatePromo(promoData.promo, promoData.url);
      promoData.promo = newPromo;

      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `Neuer Vorschlag:\n\n${newPromo}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Freigeben', callback_data: `approve:${fullKey}` },
              { text: 'Neu generieren', callback_data: `regen:${fullKey}` },
            ],
            [
              { text: 'Bearbeiten', callback_data: `edit:${fullKey}` },
              { text: 'Verwerfen', callback_data: `reject:${fullKey}` },
            ],
          ],
        },
      });
      break;
    }

    case 'edit': {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: 'Schick mir den bearbeiteten Text - ich poste ihn dann.',
      });
      // The next message will be treated as edited promo (handled via AI chat)
      break;
    }

    case 'reject': {
      pendingPromos.delete(fullKey);
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: 'Promo verworfen.',
      });
      break;
    }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Find last newline within limit
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }
  return chunks;
}

function mediaEmoji(type: string): string {
  const map: Record<string, string> = {
    photo: '[Foto]', video: '[Video]', document: '[Datei]', audio: '[Audio]',
    voice: '[Sprach]', video_note: '[VideoMsg]', sticker: '[Sticker]', animation: '[GIF]',
  };
  return map[type] ?? '[Medien]';
}

// --- Polling loop ---
async function pollUpdates(botToken: string) {
  let offset = 0;

  // Clear pending updates
  try {
    const pending = await callTelegramApi(botToken, 'getUpdates', { offset: -1, limit: 1, timeout: 0 });
    if (pending.length > 0) {
      offset = pending[pending.length - 1].update_id + 1;
    }
  } catch (_) {}

  console.log(`[${new Date().toISOString()}] M0Claw bot polling (offset=${offset})`);
  console.log(`Model: ${process.env.AI_MODEL || 'openclaw-qwen3-8b:20k'}`);
  console.log(`Ollama: ${process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1'}`);

  while (true) {
    try {
      const updates = await callTelegramApi(botToken, 'getUpdates', {
        offset,
        limit: 100,
        timeout: 30,
        allowed_updates: ['message', 'callback_query'],
      });

      for (const update of updates) {
        offset = update.update_id + 1;

        if (update.callback_query) {
          try {
            await handleCallbackQuery(botToken, update.callback_query);
          } catch (err: any) {
            console.error(`Callback error:`, err.message);
          }
        } else if (update.message) {
          try {
            await handleMessage(botToken, update.message);
          } catch (err: any) {
            console.error(`Message error ${update.update_id}:`, err.message);
          }
        }
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}] Poll error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// --- Main ---
const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('TELEGRAM_BOT_TOKEN is required.');
  process.exit(1);
}

console.log('Starting M0Claw Telegram bot...');
pollUpdates(botToken).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
