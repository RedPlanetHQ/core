import axios from 'axios';

export interface ScrapedContent {
  url: string;
  platform: string;
  title: string;
  description: string;
  author?: string;
  text: string;
  error?: string;
}

/**
 * Fetch and extract readable content from a URL
 */
export async function scrapeUrl(url: string, platform: string): Promise<ScrapedContent> {
  const result: ScrapedContent = { url, platform, title: '', description: '', text: '' };

  try {
    // For Twitter/X, try the publish oEmbed endpoint first
    if (platform === 'x') {
      return await scrapeTwitter(url, result);
    }

    // For YouTube, use oEmbed
    if (platform === 'youtube') {
      return await scrapeYouTube(url, result);
    }

    // Generic: fetch HTML and extract meta tags
    return await scrapeGeneric(url, result);
  } catch (err: any) {
    result.error = err.message;
    result.text = `Inhalt konnte nicht geladen werden: ${err.message}`;
    return result;
  }
}

async function scrapeTwitter(url: string, result: ScrapedContent): Promise<ScrapedContent> {
  try {
    // Twitter publish oEmbed API — works without auth
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
    const resp = await axios.get(oembedUrl, { timeout: 10000 });

    result.author = resp.data.author_name ?? '';
    result.title = `Tweet von ${result.author}`;

    // Extract text from the HTML embed — strip tags
    const html: string = resp.data.html ?? '';
    result.text = html
      .replace(/<blockquote[^>]*>/gi, '')
      .replace(/<\/blockquote>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/gi, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    result.description = result.text.substring(0, 200);
    return result;
  } catch {
    // Fallback to generic scraping
    return scrapeGeneric(url, result);
  }
}

async function scrapeYouTube(url: string, result: ScrapedContent): Promise<ScrapedContent> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const resp = await axios.get(oembedUrl, { timeout: 10000 });

    result.title = resp.data.title ?? '';
    result.author = resp.data.author_name ?? '';
    result.description = `YouTube Video von ${result.author}`;
    result.text = `Titel: ${result.title}\nKanal: ${result.author}`;

    // Also try to get description from page meta tags
    const pageContent = await scrapeGeneric(url, { ...result });
    if (pageContent.description) {
      result.description = pageContent.description;
      result.text = `Titel: ${result.title}\nKanal: ${result.author}\n\nBeschreibung: ${result.description}`;
    }

    return result;
  } catch {
    return scrapeGeneric(url, result);
  }
}

async function scrapeGeneric(url: string, result: ScrapedContent): Promise<ScrapedContent> {
  const resp = await axios.get(url, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; M0Claw/1.0; +https://openclaw.app)',
      Accept: 'text/html,application/xhtml+xml',
    },
    maxRedirects: 5,
    // Only fetch first 500KB
    maxContentLength: 500 * 1024,
  });

  const html: string = typeof resp.data === 'string' ? resp.data : '';

  // Extract meta tags
  result.title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title') || extractTitle(html) || '';
  result.description = extractMeta(html, 'og:description') || extractMeta(html, 'twitter:description') || extractMeta(html, 'description') || '';
  result.author = extractMeta(html, 'author') || extractMeta(html, 'og:site_name') || '';

  // Build text summary
  const parts: string[] = [];
  if (result.title) parts.push(`Titel: ${result.title}`);
  if (result.author) parts.push(`Quelle: ${result.author}`);
  if (result.description) parts.push(`\n${result.description}`);

  // Extract some body text as fallback
  if (!result.description) {
    const bodyText = extractBodyText(html);
    if (bodyText) {
      parts.push(`\n${bodyText}`);
      result.description = bodyText.substring(0, 200);
    }
  }

  result.text = parts.join('\n') || 'Kein lesbarer Inhalt gefunden.';
  return result;
}

function extractMeta(html: string, name: string): string {
  // og: and twitter: use property, others use name
  const propRegex = new RegExp(`<meta\\s+(?:property|name)=["'](?:${name})["']\\s+content=["']([^"']*)["']`, 'i');
  const propMatch = html.match(propRegex);
  if (propMatch) return decodeHtmlEntities(propMatch[1]);

  // Reversed attribute order
  const revRegex = new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+(?:property|name)=["'](?:${name})["']`, 'i');
  const revMatch = html.match(revRegex);
  if (revMatch) return decodeHtmlEntities(revMatch[1]);

  return '';
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).trim() : '';
}

function extractBodyText(html: string): string {
  // Remove script, style, nav, header, footer
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  // Extract paragraph text
  const paragraphs: string[] = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pRegex.exec(cleaned)) !== null && paragraphs.length < 5) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text.length > 30) paragraphs.push(text);
  }

  return paragraphs.join('\n\n').substring(0, 1000);
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}
