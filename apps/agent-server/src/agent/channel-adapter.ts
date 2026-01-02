import { MessageChannel } from './types';

export class ChannelAdapter {
  private channel: MessageChannel;

  constructor(channel: MessageChannel) {
    this.channel = channel;
  }

  /**
   * Adapt response for the target channel
   * For WhatsApp: Split into multiple short messages
   * For Email: Keep as single formatted message
   */
  adapt(response: string): string[] {
    switch (this.channel) {
      case 'whatsapp':
        return this.adaptForWhatsApp(response);
      case 'email':
        return [this.adaptForEmail(response)];
      default:
        return [response];
    }
  }

  private adaptForWhatsApp(response: string): string[] {
    // Clean up response
    const plainText = response
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
      .trim();

    // Split by double newlines first (paragraph breaks)
    const paragraphs = plainText.split(/\n\n+/);

    // If already short paragraphs, use them
    if (paragraphs.length > 1 && paragraphs.every((p) => p.length < 200)) {
      return paragraphs.filter((p) => p.trim().length > 0);
    }

    // Otherwise split by sentences, grouping into chunks
    const sentences = plainText.split(/(?<=[.!?])\s+/);
    const messages: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if ((current + ' ' + sentence).length > 200) {
        if (current) messages.push(current.trim());
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }

    if (current) messages.push(current.trim());

    // Return at least one message, max 4
    const result = messages.length > 0 ? messages.slice(0, 4) : [plainText];
    return result.filter((m) => m.length > 0);
  }

  private adaptForEmail(response: string): string {
    // Keep response mostly as-is for email
    // Just clean up excessive whitespace
    return response.replace(/\n{3,}/g, '\n\n').trim();
  }
}
