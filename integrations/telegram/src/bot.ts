import { callTelegramApi, formatUser } from './utils';
import { extractMedia, downloadTelegramFile, extractUrls, classifyUrl, getStorageStats } from './media';
import { chat, clearSession, getSessionInfo, getProviderName, generatePromo } from './chat';
import { scrapeUrl } from './scraper';

// --- Pending promo drafts (per chat) ---
interface PendingPromo {
  draft: string;
  scrapedContent: string;
  sourceUrl: string;
  platform: string;
  messageId: number; // the message with inline buttons
  createdAt: number;
}

const pendingPromos = new Map<number, PendingPromo>();

// --- Chats waiting for edit feedback ---
const awaitingFeedback = new Set<number>();

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
        'Schick mir einen Link — ich erstelle sofort einen Promo-Post.',
        'Du kannst ihn dann freigeben, bearbeiten oder verwerfen.',
        '',
        'Oder schreib mir einfach — ich antworte wie ein AI-Chat.',
        '',
        'Befehle:',
        '/start  — Diese Hilfe',
        '/clear  — Chat-Verlauf löschen',
        '/status — Bot-Status & Speicher',
        '/ping   — Pong!',
      ].join('\n'),
    });
    return;
  }

  if (text === '/clear') {
    clearSession(chatId);
    pendingPromos.delete(chatId);
    awaitingFeedback.delete(chatId);
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: 'Chat-Verlauf gelöscht. Neuer Chat gestartet.',
    });
    return;
  }

  if (text === '/status') {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const stats = getStorageStats();
    const session = getSessionInfo(chatId);
    const hasPending = pendingPromos.has(chatId);
    const typeLines = Object.entries(stats.byType)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: [
        `Status: Online`,
        `Uptime: ${h}h ${m}m`,
        `AI: ${getProviderName()}`,
        `Chat-Nachrichten: ${session.messageCount}`,
        `Dateien: ${stats.totalFiles} (${stats.totalSizeMB} MB)`,
        hasPending ? '\nPromo-Entwurf: ausstehend' : '',
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

  // --- If awaiting edit feedback for a pending promo ---
  if (awaitingFeedback.has(chatId) && text) {
    const pending = pendingPromos.get(chatId);
    if (pending) {
      awaitingFeedback.delete(chatId);

      await callTelegramApi(botToken, 'sendChatAction', { chat_id: chatId, action: 'typing' });

      const revisedDraft = await generatePromo(
        pending.scrapedContent + `\n\nVorheriger Entwurf:\n${pending.draft}`,
        text,
      );

      pending.draft = revisedDraft;

      // Send revised draft with buttons
      const sent = await sendPromoPreview(botToken, chatId, revisedDraft, pending.sourceUrl);
      pending.messageId = sent.message_id;

      return;
    }
    awaitingFeedback.delete(chatId);
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

    // Also check caption for URLs → trigger promo flow
    const urls = extractUrls(message);
    if (urls.length > 0) {
      await handleUrlsWithPromo(botToken, chatId, urls);
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

  // --- URL handling → Promo flow ---
  const urls = extractUrls(message);
  if (urls.length > 0) {
    await handleUrlsWithPromo(botToken, chatId, urls);
    return;
  }

  // --- Forwarded messages (no URLs) → Promo flow ---
  const isForwarded = !!(message.forward_date || message.forward_from || message.forward_from_chat || message.forward_origin);
  if (isForwarded && text && text.length > 20) {
    await handleContentAsPromo(botToken, chatId, text, 'forwarded');
    return;
  }

  // --- Long pasted text (likely a copied post) → Promo flow ---
  if (text && text.length > 100 && !text.endsWith('?')) {
    await handleContentAsPromo(botToken, chatId, text, 'pasted');
    return;
  }

  // --- Plain text → AI Chat ---
  if (text) {
    await callTelegramApi(botToken, 'sendChatAction', { chat_id: chatId, action: 'typing' });

    const reply = await chat(chatId, text);

    const chunks = splitMessage(reply, 4000);
    for (const chunk of chunks) {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      });
    }
    return;
  }

  // Fallback for unknown message types
  await callTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: 'Nachricht empfangen (Typ nicht erkannt).',
  });
}

// --- Promo flow: scrape → generate → preview with buttons ---
async function handleUrlsWithPromo(botToken: string, chatId: number, urls: string[]) {
  // Process the first URL for promo (can be extended for multiple)
  const url = urls[0];
  const info = classifyUrl(url);

  await callTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: `${platformEmoji(info.platform)} ${info.platform} Link erkannt — lade Inhalt...`,
    disable_web_page_preview: true,
  });

  await callTelegramApi(botToken, 'sendChatAction', { chat_id: chatId, action: 'typing' });

  // Scrape the URL
  const scraped = await scrapeUrl(url, info.platform);

  if (scraped.error && !scraped.text) {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `Fehler beim Laden: ${scraped.error}\n\nSchick mir den Inhalt manuell, dann erstelle ich den Promo daraus.`,
    });
    return;
  }

  // Show what was scraped
  const scrapedPreview = scraped.text.substring(0, 500) + (scraped.text.length > 500 ? '...' : '');
  await callTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: `Inhalt geladen:\n\n${scrapedPreview}`,
    disable_web_page_preview: true,
  });

  await callTelegramApi(botToken, 'sendChatAction', { chat_id: chatId, action: 'typing' });

  // Generate promo
  const draft = await generatePromo(scraped.text);

  // Store pending promo
  const sent = await sendPromoPreview(botToken, chatId, draft, url);

  pendingPromos.set(chatId, {
    draft,
    scrapedContent: scraped.text,
    sourceUrl: url,
    platform: info.platform,
    messageId: sent.message_id,
    createdAt: Date.now(),
  });

  // If there are more URLs, mention them
  if (urls.length > 1) {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `(${urls.length - 1} weitere Links erkannt — schick sie einzeln für separate Promos)`,
    });
  }
}

// --- Handle pasted/forwarded content as promo source ---
async function handleContentAsPromo(botToken: string, chatId: number, content: string, source: string) {
  const sourceLabel = source === 'forwarded' ? 'Weitergeleiteter Post' : 'Kopierter Text';

  await callTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: `${sourceLabel} erkannt — erstelle Promo-Post...`,
  });

  await callTelegramApi(botToken, 'sendChatAction', { chat_id: chatId, action: 'typing' });

  const draft = await generatePromo(content);
  const sent = await sendPromoPreview(botToken, chatId, draft, `[${sourceLabel}]`);

  pendingPromos.set(chatId, {
    draft,
    scrapedContent: content,
    sourceUrl: `[${sourceLabel}]`,
    platform: 'text',
    messageId: sent.message_id,
    createdAt: Date.now(),
  });
}

// --- Send promo preview with inline keyboard ---
async function sendPromoPreview(botToken: string, chatId: number, draft: string, sourceUrl: string) {
  return await callTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: [
      '--- PROMO ENTWURF ---',
      '',
      draft,
      '',
      '--- ENDE ---',
      '',
      `Quelle: ${sourceUrl}`,
    ].join('\n'),
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Freigeben', callback_data: 'promo_approve' },
          { text: 'Bearbeiten', callback_data: 'promo_edit' },
          { text: 'Verwerfen', callback_data: 'promo_discard' },
        ],
        [
          { text: 'Neu generieren', callback_data: 'promo_regenerate' },
        ],
      ],
    },
  });
}

// --- Handle callback queries (button clicks) ---
async function handleCallbackQuery(botToken: string, query: any) {
  const chatId = query.message?.chat?.id;
  const data = query.data;
  const callbackId = query.id;

  if (!chatId || !data) {
    await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: callbackId });
    return;
  }

  const pending = pendingPromos.get(chatId);

  if (!pending) {
    await callTelegramApi(botToken, 'answerCallbackQuery', {
      callback_query_id: callbackId,
      text: 'Kein Entwurf vorhanden.',
      show_alert: true,
    });
    return;
  }

  switch (data) {
    case 'promo_approve': {
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callbackId,
        text: 'Freigegeben!',
      });

      // Remove inline buttons from the preview message
      await callTelegramApi(botToken, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: pending.messageId,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {}); // ignore if message can't be edited

      // Post to target channel if configured
      const targetChannel = process.env.TELEGRAM_TARGET_CHANNEL;
      if (targetChannel) {
        try {
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: targetChannel,
            text: pending.draft,
            disable_web_page_preview: false,
          });

          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: 'GEPOSTET — Der Promo-Post wurde im Kanal veroeffentlicht.',
            disable_web_page_preview: true,
          });
        } catch (err: any) {
          console.error(`[PROMO] Failed to post to channel ${targetChannel}:`, err.message);
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: [
              `Fehler beim Posten im Kanal: ${err.message}`,
              '',
              'Fertiger Post zum manuellen Kopieren:',
              '',
              pending.draft,
            ].join('\n'),
            disable_web_page_preview: true,
          });
        }
      } else {
        // No target channel — send text for manual copy
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: [
            'FREIGEGEBEN — Fertiger Post:',
            '',
            pending.draft,
            '',
            'Kopiere den Text oben und poste ihn direkt.',
            '',
            'Tipp: Setze TELEGRAM_TARGET_CHANNEL in .env fuer automatisches Posten.',
          ].join('\n'),
          disable_web_page_preview: true,
        });
      }

      pendingPromos.delete(chatId);
      awaitingFeedback.delete(chatId);

      console.log(`[PROMO] Approved for chat ${chatId}: ${pending.sourceUrl}`);
      break;
    }

    case 'promo_edit': {
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callbackId,
      });

      awaitingFeedback.add(chatId);

      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: [
          'Was soll ich aendern?',
          '',
          'Schreib mir dein Feedback, z.B.:',
          '- "Kuerzer"',
          '- "Mehr Emojis"',
          '- "Auf Englisch"',
          '- "Fuer LinkedIn statt Twitter"',
          '- "Aggressiver / mehr Hype"',
        ].join('\n'),
      });
      break;
    }

    case 'promo_discard': {
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callbackId,
        text: 'Verworfen.',
      });

      // Remove inline buttons
      await callTelegramApi(botToken, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: pending.messageId,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});

      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: 'Entwurf verworfen. Schick mir einen neuen Link wenn du willst.',
      });

      pendingPromos.delete(chatId);
      awaitingFeedback.delete(chatId);
      break;
    }

    case 'promo_regenerate': {
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: callbackId,
        text: 'Wird neu generiert...',
      });

      await callTelegramApi(botToken, 'sendChatAction', { chat_id: chatId, action: 'typing' });

      const newDraft = await generatePromo(pending.scrapedContent);
      pending.draft = newDraft;

      // Remove old buttons
      await callTelegramApi(botToken, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: pending.messageId,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});

      // Send new preview
      const sent = await sendPromoPreview(botToken, chatId, newDraft, pending.sourceUrl);
      pending.messageId = sent.message_id;

      break;
    }

    default: {
      await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: callbackId });
    }
  }
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

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }
  return chunks;
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
        allowed_updates: ['message', 'callback_query'],
      });

      for (const update of updates) {
        offset = update.update_id + 1;

        if (update.callback_query) {
          try {
            await handleCallbackQuery(botToken, update.callback_query);
          } catch (err: any) {
            console.error(`Error handling callback ${update.update_id}:`, err.message);
          }
        } else if (update.message) {
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
