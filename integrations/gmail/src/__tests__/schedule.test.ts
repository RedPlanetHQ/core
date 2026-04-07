import { describe, expect, test } from 'bun:test';

import {
  formatMetadataText,
  getDefaultSyncTime,
  getHeader,
  GmailEmailMetadata,
  toGmailTimestamp,
} from '../schedule-utils';

describe('toGmailTimestamp', () => {
  test('converts ISO date to Unix timestamp in seconds', () => {
    const iso = '2024-01-15T10:00:00.000Z';
    const expected = Math.floor(new Date(iso).getTime() / 1000);
    expect(toGmailTimestamp(iso)).toBe(expected);
  });

  test('returns an integer (floor)', () => {
    const ts = toGmailTimestamp('2024-06-01T00:00:00.500Z');
    expect(Number.isInteger(ts)).toBe(true);
  });
});

describe('getDefaultSyncTime', () => {
  test('returns an ISO string approximately 24 hours ago', () => {
    const before = Date.now();
    const result = getDefaultSyncTime();

    const resultMs = new Date(result).getTime();
    const expectedMs = before - 24 * 60 * 60 * 1000;

    // Within 100 ms of expected
    expect(Math.abs(resultMs - expectedMs)).toBeLessThan(100);
  });

  test('returns a valid ISO string', () => {
    const result = getDefaultSyncTime();
    expect(new Date(result).toISOString()).toBe(result);
  });
});

describe('getHeader', () => {
  const headers = [
    { name: 'From', value: 'Alice <alice@example.com>' },
    { name: 'Subject', value: 'Hello' },
    { name: 'To', value: 'Bob <bob@example.com>' },
  ];

  test('finds a header by exact name', () => {
    expect(getHeader(headers, 'From')).toBe('Alice <alice@example.com>');
  });

  test('is case-insensitive', () => {
    expect(getHeader(headers, 'subject')).toBe('Hello');
    expect(getHeader(headers, 'SUBJECT')).toBe('Hello');
  });

  test('returns empty string when header not found', () => {
    expect(getHeader(headers, 'Cc')).toBe('');
  });
});

describe('formatMetadataText', () => {
  const baseMeta: GmailEmailMetadata = {
    id: 'msg123',
    threadId: 'thread456',
    subject: 'Hello World',
    from: 'Alice <alice@example.com>',
    to: 'Bob <bob@example.com>',
    date: 'Mon, 15 Jan 2024 10:00:00 +0000',
    internalDate: 1705312800000,
    snippet: 'This is a short preview...',
    labelIds: ['INBOX', 'IMPORTANT'],
    sizeEstimate: 4096,
    webLink: 'https://mail.google.com/mail/u/0/#inbox/msg123',
  };

  test('received email uses envelope icon and "Email from" heading', () => {
    const text = formatMetadataText(baseMeta, 'received');
    expect(text).toContain('📧');
    expect(text).toContain('Email from Alice <alice@example.com>');
  });

  test('sent email uses outbox icon and "Email to" heading', () => {
    const text = formatMetadataText(baseMeta, 'sent');
    expect(text).toContain('📤');
    expect(text).toContain('Email to Bob <bob@example.com>');
  });

  test('includes all required metadata fields', () => {
    const text = formatMetadataText(baseMeta, 'received');
    expect(text).toContain('**ID:** msg123');
    expect(text).toContain('**Thread ID:** thread456');
    expect(text).toContain('**Subject:** Hello World');
    expect(text).toContain('**From:** Alice <alice@example.com>');
    expect(text).toContain('**To:** Bob <bob@example.com>');
    expect(text).toContain('**Date:** Mon, 15 Jan 2024 10:00:00 +0000');
    expect(text).toContain('**Internal Date:** 1705312800000');
    expect(text).toContain('**Snippet:** This is a short preview...');
    expect(text).toContain('**Labels:** INBOX, IMPORTANT');
    expect(text).toContain('**Size:** 4096 bytes');
    expect(text).toContain('**Link:** https://mail.google.com/mail/u/0/#inbox/msg123');
  });

  test('includes historyId when present', () => {
    const meta = { ...baseMeta, historyId: 'hist789' };
    const text = formatMetadataText(meta, 'received');
    expect(text).toContain('**History ID:** hist789');
  });

  test('omits historyId line when not present', () => {
    const text = formatMetadataText(baseMeta, 'received');
    expect(text).not.toContain('History ID');
  });

  test('includes Cc when present', () => {
    const meta = { ...baseMeta, cc: 'Charlie <charlie@example.com>' };
    const text = formatMetadataText(meta, 'received');
    expect(text).toContain('**Cc:** Charlie <charlie@example.com>');
  });

  test('omits Cc line when not present', () => {
    const text = formatMetadataText(baseMeta, 'received');
    expect(text).not.toContain('**Cc:**');
  });

  test('includes Bcc when present', () => {
    const meta = { ...baseMeta, bcc: 'Dan <dan@example.com>' };
    const text = formatMetadataText(meta, 'received');
    expect(text).toContain('**Bcc:** Dan <dan@example.com>');
  });

  test('does not contain HTML body tags', () => {
    const text = formatMetadataText(baseMeta, 'received');
    // Email addresses use angle brackets which are fine; actual HTML elements should not appear
    expect(text).not.toMatch(/<(html|body|div|p|span|br|img|a\s)[^>]*>/i);
  });
});
