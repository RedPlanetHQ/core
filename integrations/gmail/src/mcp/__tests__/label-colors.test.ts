import { describe, it, expect } from 'vitest';
import {
  resolveLabelColor,
  GMAIL_LABEL_PALETTE,
  ALLOWED_HEX_VALUES,
} from '../label-colors';

describe('resolveLabelColor', () => {
  it('resolves a known preset key to its pair', () => {
    const result = resolveLabelColor('blue');
    expect(result).toEqual(GMAIL_LABEL_PALETTE.blue);
  });

  it('resolves every preset key without throwing', () => {
    for (const key of Object.keys(GMAIL_LABEL_PALETTE)) {
      expect(() => resolveLabelColor(key)).not.toThrow();
    }
  });

  it('accepts an explicit pair where both values are in the palette', () => {
    const result = resolveLabelColor({
      textColor: '#ffffff',
      backgroundColor: '#4a86e8',
    });
    expect(result).toEqual({ textColor: '#ffffff', backgroundColor: '#4a86e8' });
  });

  it('normalizes uppercase hex input to lowercase', () => {
    const result = resolveLabelColor({
      textColor: '#FFFFFF',
      backgroundColor: '#4A86E8',
    });
    expect(result).toEqual({ textColor: '#ffffff', backgroundColor: '#4a86e8' });
  });

  it('throws on unknown preset with a message listing valid keys', () => {
    expect(() => resolveLabelColor('mauve')).toThrow(/Unknown color preset 'mauve'/);
    expect(() => resolveLabelColor('mauve')).toThrow(/Valid presets:/);
    expect(() => resolveLabelColor('mauve')).toThrow(/blue/);
  });

  it('throws on explicit pair with invalid textColor', () => {
    expect(() =>
      resolveLabelColor({ textColor: '#123456', backgroundColor: '#4a86e8' })
    ).toThrow(/Invalid textColor '#123456'/);
  });

  it('throws on explicit pair with invalid backgroundColor', () => {
    expect(() =>
      resolveLabelColor({ textColor: '#ffffff', backgroundColor: '#abcdef' })
    ).toThrow(/Invalid backgroundColor '#abcdef'/);
  });

  it('ALLOWED_HEX_VALUES contains 89 entries', () => {
    expect(ALLOWED_HEX_VALUES.size).toBe(89);
  });

  it('every preset pair uses values from ALLOWED_HEX_VALUES', () => {
    for (const [, pair] of Object.entries(GMAIL_LABEL_PALETTE)) {
      expect(ALLOWED_HEX_VALUES.has(pair.textColor)).toBe(true);
      expect(ALLOWED_HEX_VALUES.has(pair.backgroundColor)).toBe(true);
    }
  });
});
