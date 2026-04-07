export interface GmailEmailMetadata {
  id: string;
  threadId: string;
  historyId?: string;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  date: string;
  internalDate: number;
  snippet: string;
  labelIds: string[];
  sizeEstimate: number;
  webLink: string;
}

/**
 * Gets default sync time (24 hours ago).
 */
export function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Convert ISO date to Gmail query format as Unix timestamp in seconds.
 * Using timestamp is more precise than YYYY/MM/DD which truncates to day.
 */
export function toGmailTimestamp(isoDate: string): number {
  return Math.floor(new Date(isoDate).getTime() / 1000);
}

/**
 * Format email metadata as structured Markdown text (no body content).
 */
export function formatMetadataText(
  meta: GmailEmailMetadata,
  direction: 'received' | 'sent'
): string {
  const icon = direction === 'received' ? '📧' : '📤';
  const label = direction === 'received' ? `Email from ${meta.from}` : `Email to ${meta.to}`;

  const lines = [
    `## ${icon} ${label}`,
    '',
    `**ID:** ${meta.id}`,
    `**Thread ID:** ${meta.threadId}`,
  ];

  if (meta.historyId) {
    lines.push(`**History ID:** ${meta.historyId}`);
  }

  lines.push(
    `**Subject:** ${meta.subject}`,
    `**From:** ${meta.from}`,
    `**To:** ${meta.to}`
  );

  if (meta.cc) lines.push(`**Cc:** ${meta.cc}`);
  if (meta.bcc) lines.push(`**Bcc:** ${meta.bcc}`);

  lines.push(
    `**Date:** ${meta.date}`,
    `**Internal Date:** ${meta.internalDate}`,
    `**Snippet:** ${meta.snippet}`,
    `**Labels:** ${meta.labelIds.join(', ')}`,
    `**Size:** ${meta.sizeEstimate} bytes`,
    `**Link:** ${meta.webLink}`
  );

  return lines.join('\n');
}

/**
 * Extract a header value from a Gmail message headers array.
 */
export function getHeader(
  headers: Array<{ name: string; value: string }>,
  name: string
): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}
