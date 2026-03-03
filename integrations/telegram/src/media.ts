import axios from 'axios';
import { callTelegramApi } from './utils';
import * as fs from 'fs';
import * as path from 'path';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DOWNLOADS_DIR = process.env.OPENCLAW_DOWNLOADS ?? path.join(process.env.HOME ?? '/tmp', '.openclaw', 'downloads', 'telegram');

export interface MediaFile {
  fileId: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
  localPath: string;
  type: MediaType;
}

export type MediaType =
  | 'photo'
  | 'video'
  | 'document'
  | 'audio'
  | 'voice'
  | 'video_note'
  | 'sticker'
  | 'animation'
  | 'contact'
  | 'location'
  | 'venue';

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Download a file from Telegram servers to local storage
 */
export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
  fileName: string,
  subDir: string
): Promise<string> {
  const fileInfo = await callTelegramApi(botToken, 'getFile', { file_id: fileId });
  const filePath = fileInfo.file_path;
  const downloadUrl = `${TELEGRAM_API_BASE}/file/bot${botToken}/${filePath}`;

  const targetDir = path.join(DOWNLOADS_DIR, subDir);
  ensureDir(targetDir);

  // Use original extension from Telegram if fileName has none
  const ext = path.extname(fileName) || path.extname(filePath) || '';
  const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}${ext && !fileName.endsWith(ext) ? ext : ''}`;
  const localPath = path.join(targetDir, safeName);

  const response = await axios.get(downloadUrl, { responseType: 'stream' });
  const writer = fs.createWriteStream(localPath);

  await new Promise<void>((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  console.log(`[DOWNLOAD] ${localPath} (${(fileInfo.file_size / 1024).toFixed(1)} KB)`);
  return localPath;
}

/**
 * Extract media info from a Telegram message
 */
export function extractMedia(message: any): { fileId: string; fileName: string; type: MediaType; mimeType?: string; fileSize?: number } | null {
  // Photo — take the largest resolution
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    return {
      fileId: largest.file_id,
      fileName: `photo_${message.message_id}.jpg`,
      type: 'photo',
      mimeType: 'image/jpeg',
      fileSize: largest.file_size,
    };
  }

  // Video
  if (message.video) {
    return {
      fileId: message.video.file_id,
      fileName: message.video.file_name ?? `video_${message.message_id}.mp4`,
      type: 'video',
      mimeType: message.video.mime_type,
      fileSize: message.video.file_size,
    };
  }

  // Document (any file)
  if (message.document) {
    return {
      fileId: message.document.file_id,
      fileName: message.document.file_name ?? `document_${message.message_id}`,
      type: 'document',
      mimeType: message.document.mime_type,
      fileSize: message.document.file_size,
    };
  }

  // Audio
  if (message.audio) {
    return {
      fileId: message.audio.file_id,
      fileName: message.audio.file_name ?? `audio_${message.message_id}.mp3`,
      type: 'audio',
      mimeType: message.audio.mime_type,
      fileSize: message.audio.file_size,
    };
  }

  // Voice message
  if (message.voice) {
    return {
      fileId: message.voice.file_id,
      fileName: `voice_${message.message_id}.ogg`,
      type: 'voice',
      mimeType: message.voice.mime_type ?? 'audio/ogg',
      fileSize: message.voice.file_size,
    };
  }

  // Video note (round video)
  if (message.video_note) {
    return {
      fileId: message.video_note.file_id,
      fileName: `videonote_${message.message_id}.mp4`,
      type: 'video_note',
      mimeType: 'video/mp4',
      fileSize: message.video_note.file_size,
    };
  }

  // Sticker
  if (message.sticker) {
    const ext = message.sticker.is_animated ? '.tgs' : message.sticker.is_video ? '.webm' : '.webp';
    return {
      fileId: message.sticker.file_id,
      fileName: `sticker_${message.message_id}${ext}`,
      type: 'sticker',
      fileSize: message.sticker.file_size,
    };
  }

  // Animation (GIF)
  if (message.animation) {
    return {
      fileId: message.animation.file_id,
      fileName: message.animation.file_name ?? `animation_${message.message_id}.mp4`,
      type: 'animation',
      mimeType: message.animation.mime_type,
      fileSize: message.animation.file_size,
    };
  }

  return null;
}

/**
 * Extract URLs from a message (text + entities)
 */
export function extractUrls(message: any): string[] {
  const urls: string[] = [];
  const text = message.text ?? message.caption ?? '';

  // From entities
  if (message.entities || message.caption_entities) {
    const entities = message.entities ?? message.caption_entities ?? [];
    for (const entity of entities) {
      if (entity.type === 'url') {
        urls.push(text.substring(entity.offset, entity.offset + entity.length));
      } else if (entity.type === 'text_link' && entity.url) {
        urls.push(entity.url);
      }
    }
  }

  // Fallback: regex for URLs not captured by entities
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const matches = text.match(urlRegex) ?? [];
  for (const m of matches) {
    if (!urls.includes(m)) urls.push(m);
  }

  return urls;
}

/**
 * Classify a URL by platform/type
 */
export function classifyUrl(url: string): { platform: string; type: string } {
  const u = url.toLowerCase();

  if (u.includes('instagram.com') || u.includes('instagr.am')) {
    if (u.includes('/reel')) return { platform: 'instagram', type: 'reel' };
    if (u.includes('/p/')) return { platform: 'instagram', type: 'post' };
    if (u.includes('/stories/')) return { platform: 'instagram', type: 'story' };
    return { platform: 'instagram', type: 'link' };
  }

  if (u.includes('tiktok.com') || u.includes('vm.tiktok.com')) {
    return { platform: 'tiktok', type: 'video' };
  }

  if (u.includes('youtube.com') || u.includes('youtu.be')) {
    if (u.includes('/shorts/')) return { platform: 'youtube', type: 'short' };
    return { platform: 'youtube', type: 'video' };
  }

  if (u.includes('twitter.com') || u.includes('x.com')) {
    return { platform: 'x', type: 'post' };
  }

  if (u.includes('t.me')) {
    return { platform: 'telegram', type: 'link' };
  }

  if (u.includes('reddit.com')) {
    return { platform: 'reddit', type: 'post' };
  }

  // File extensions
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i.test(u)) return { platform: 'direct', type: 'image' };
  if (/\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(u)) return { platform: 'direct', type: 'video' };
  if (/\.(mp3|wav|flac|ogg|aac|m4a)(\?|$)/i.test(u)) return { platform: 'direct', type: 'audio' };
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z)(\?|$)/i.test(u)) return { platform: 'direct', type: 'document' };

  return { platform: 'web', type: 'link' };
}

/**
 * Get a summary of downloads directory
 */
export function getStorageStats(): { totalFiles: number; totalSizeMB: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  let totalFiles = 0;
  let totalSize = 0;

  if (!fs.existsSync(DOWNLOADS_DIR)) {
    return { totalFiles: 0, totalSizeMB: 0, byType: {} };
  }

  const subdirs = fs.readdirSync(DOWNLOADS_DIR);
  for (const sub of subdirs) {
    const subPath = path.join(DOWNLOADS_DIR, sub);
    if (!fs.statSync(subPath).isDirectory()) continue;

    const files = fs.readdirSync(subPath);
    byType[sub] = files.length;
    totalFiles += files.length;

    for (const f of files) {
      totalSize += fs.statSync(path.join(subPath, f)).size;
    }
  }

  return { totalFiles, totalSizeMB: Math.round(totalSize / 1024 / 1024 * 10) / 10, byType };
}
