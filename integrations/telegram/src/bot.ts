import { callTelegramApi, formatUser } from './utils';
import { extractMedia, downloadTelegramFile, extractUrls, classifyUrl, getStorageStats } from './media';

async function handleMessage(botToken: string, message: any) {
  const chatId = message.chat.id;
  const text = (message.text ?? message.caption ?? '').trim();
  const from = message.from ? formatUser(message.from) : 'Unknown';

  console.log(`[${new Date().toISOString()}] ${from}: ${text || '[media]'}`);

  // --- Commands ---
  if (text === '/start') {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: [
        `Hey ${message.from?.first_name ?? 'there'}! Ich bin M0Claw.`,
        '',
        'Schick mir alles — ich verarbeite es:',
        '  Fotos, Videos, Dokumente, Audio, Sprachnachrichten',
        '  Links (Instagram, YouTube, TikTok, X, ...)',
        '  Dateien jeder Art',
        '',
        'Befehle:',
        '/start  — Diese Hilfe',
        '/status — Bot-Status & Speicher',
        '/ping   — Pong!',
      ].join('\n'),
    });
    return;
  }

  if (text === '/status') {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const stats = getStorageStats();
    const typeLines = Object.entries(stats.byType)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: [
        `Status: Online`,
        `Uptime: ${h}h ${m}m`,
        `Dateien: ${stats.totalFiles} (${stats.totalSizeMB} MB)`,
        typeLines ? `\nNach Typ:\n${typeLines}` : '',
      ].join('\n'),
    });
    return;
  }

  if (text === '/ping') {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: 'Pong!',
    });
    return;
  }

  // --- Media handling ---
  const media = extractMedia(message);
  if (media) {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `${mediaEmoji(media.type)} ${mediaLabel(media.type)} empfangen — wird heruntergeladen...`,
    });

    try {
      const localPath = await downloadTelegramFile(botToken, media.fileId, media.fileName, media.type);
      const sizeKB = media.fileSize ? (media.fileSize / 1024).toFixed(1) : '?';

      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: [
          `${mediaEmoji(media.type)} ${mediaLabel(media.type)} gespeichert`,
          `Datei: ${media.fileName}`,
          `Typ: ${media.mimeType ?? 'unbekannt'}`,
          `Groesse: ${sizeKB} KB`,
          `Pfad: ${localPath}`,
        ].join('\n'),
      });
    } catch (err: any) {
      console.error(`Download error:`, err.message);
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `Fehler beim Download: ${err.message}`,
      });
    }

    // Also check caption for URLs
    const urls = extractUrls(message);
    if (urls.length > 0) {
      await handleUrls(botToken, chatId, urls);
    }
    return;
  }

  // --- Contact ---
  if (message.contact) {
    const c = message.contact;
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: [
        'Kontakt empfangen:',
        `Name: ${c.first_name} ${c.last_name ?? ''}`.trim(),
        c.phone_number ? `Tel: ${c.phone_number}` : '',
        c.vcard ? 'vCard vorhanden' : '',
      ].filter(Boolean).join('\n'),
    });
    return;
  }

  // --- Location ---
  if (message.location) {
    const loc = message.location;
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `Standort empfangen: ${loc.latitude}, ${loc.longitude}`,
    });
    return;
  }

  // --- URL handling ---
  const urls = extractUrls(message);
  if (urls.length > 0) {
    await handleUrls(botToken, chatId, urls);
    return;
  }

  // --- Plain text ---
  if (text) {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `Nachricht erhalten: "${text.substring(0, 500)}"`,
    });
    return;
  }

  // Fallback for unknown message types
  await callTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: 'Nachricht empfangen (Typ nicht erkannt).',
  });
}

async function handleUrls(botToken: string, chatId: number, urls: string[]) {
  const lines: string[] = ['Links erkannt:'];

  for (const url of urls) {
    const info = classifyUrl(url);
    lines.push(`  ${platformEmoji(info.platform)} ${info.platform} (${info.type}): ${url}`);
  }

  lines.push('', 'Links werden zur Verarbeitung vorgemerkt.');

  await callTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: lines.join('\n'),
    disable_web_page_preview: true,
  });
}

function mediaEmoji(type: string): string {
  const map: Record<string, string> = {
    photo: '[Foto]',
    video: '[Video]',
    document: '[Datei]',
    audio: '[Audio]',
    voice: '[Sprach]',
    video_note: '[VideoMsg]',
    sticker: '[Sticker]',
    animation: '[GIF]',
  };
  return map[type] ?? '[Medien]';
}

function mediaLabel(type: string): string {
  const map: Record<string, string> = {
    photo: 'Foto',
    video: 'Video',
    document: 'Dokument',
    audio: 'Audiodatei',
    voice: 'Sprachnachricht',
    video_note: 'Videonachricht',
    sticker: 'Sticker',
    animation: 'GIF/Animation',
  };
  return map[type] ?? 'Medien';
}

function platformEmoji(platform: string): string {
  const map: Record<string, string> = {
    instagram: '[IG]',
    tiktok: '[TT]',
    youtube: '[YT]',
    x: '[X]',
    telegram: '[TG]',
    reddit: '[RD]',
    direct: '[->]',
    web: '[WEB]',
  };
  return map[platform] ?? '[?]';
}

// --- Polling loop ---
async function pollUpdates(botToken: string) {
  let offset = 0;

  // Clear pending updates so we only process new ones
  try {
    const pending = await callTelegramApi(botToken, 'getUpdates', { offset: -1, limit: 1, timeout: 0 });
    if (pending.length > 0) {
      offset = pending[pending.length - 1].update_id + 1;
    }
  } catch (_) {}

  console.log(`[${new Date().toISOString()}] M0Claw bot polling started (offset=${offset})`);

  while (true) {
    try {
      const updates = await callTelegramApi(botToken, 'getUpdates', {
        offset,
        limit: 100,
        timeout: 30,
        allowed_updates: ['message'],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) {
          try {
            await handleMessage(botToken, update.message);
          } catch (err: any) {
            console.error(`Error handling message ${update.update_id}:`, err.message);
          }
        }
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}] Polling error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// --- Main ---
const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('TELEGRAM_BOT_TOKEN is required.');
  console.error('Usage: TELEGRAM_BOT_TOKEN=your-token npx tsx src/bot.ts');
  process.exit(1);
}

console.log('Starting M0Claw Telegram bot...');
pollUpdates(botToken).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
