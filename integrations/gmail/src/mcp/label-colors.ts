/**
 * Gmail label color palette.
 *
 * The Gmail API accepts label colors only from a fixed palette of 89 hex values.
 * Arbitrary hex is rejected by the API. Gmail renders a single color pair in
 * both light and dark themes automatically, so there is no per-theme input.
 *
 * Reference: https://developers.google.com/gmail/api/reference/rest/v1/users.labels
 */

export interface LabelColorPair {
  textColor: string;
  backgroundColor: string;
}

// All 89 hex values accepted by Gmail's label color API.
// Sourced from the Gmail API reference; lowercase per Gmail's format.
export const ALLOWED_HEX_VALUES: ReadonlySet<string> = new Set([
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#efefef', '#f3f3f3', '#ffffff',
  '#fb4c2f', '#ffad47', '#fad165', '#16a766', '#43d692', '#4a86e8', '#a479e2', '#f691b3',
  '#f6c5be', '#ffe6c7', '#fef1d1', '#b9e4d0', '#c6f3de', '#c9daf8', '#e4d7f5', '#fcdee8',
  '#efa093', '#ffd6a2', '#fce8b3', '#89d3b2', '#a0eac9', '#a4c2f4', '#d0bcf1', '#fbc8d9',
  '#e66550', '#ffbc6b', '#fcda83', '#44b984', '#68dfa9', '#6d9eeb', '#b694e8', '#f7a7c0',
  '#cc3a21', '#eaa041', '#f2c960', '#149e60', '#3dc789', '#3c78d8', '#8e63ce', '#e07798',
  '#ac2b16', '#cf8933', '#d5ae49', '#0b804b', '#2a9c68', '#285bac', '#653e9b', '#b65775',
  '#822111', '#a46a21', '#aa8831', '#076239', '#1a764d', '#1c4587', '#41236d', '#83334c',
  '#464646', '#e7e7e7', '#0d3472', '#b6cff5', '#0d3b44', '#98d7e4', '#3d188e', '#e3d7ff',
  '#711a36', '#fbd3e0', '#8a1c0a', '#f2b2a8', '#7a2e0b', '#ffc8af', '#7a4706', '#ffdeb5',
  '#594c05', '#fbe983', '#684e07', '#fdedc1', '#0b4f30', '#b3efd3', '#04502e', '#a2dcc1',
  '#c2c2c2',
]);

// Curated preset keys for Gmail's most common UI swatches.
// Each pair uses values from ALLOWED_HEX_VALUES.
export const GMAIL_LABEL_PALETTE = {
  black: { backgroundColor: '#000000', textColor: '#ffffff' },
  gray: { backgroundColor: '#666666', textColor: '#ffffff' },
  white: { backgroundColor: '#ffffff', textColor: '#000000' },
  red: { backgroundColor: '#fb4c2f', textColor: '#ffffff' },
  orange: { backgroundColor: '#ffad47', textColor: '#ffffff' },
  yellow: { backgroundColor: '#fad165', textColor: '#000000' },
  green: { backgroundColor: '#16a766', textColor: '#ffffff' },
  teal: { backgroundColor: '#43d692', textColor: '#ffffff' },
  blue: { backgroundColor: '#4a86e8', textColor: '#ffffff' },
  purple: { backgroundColor: '#a479e2', textColor: '#ffffff' },
  pink: { backgroundColor: '#f691b3', textColor: '#ffffff' },
  brown: { backgroundColor: '#8a1c0a', textColor: '#ffffff' },
} as const satisfies Record<string, LabelColorPair>;

export type LabelColorPreset = keyof typeof GMAIL_LABEL_PALETTE;

const GMAIL_PALETTE_DOC_URL =
  'https://developers.google.com/gmail/api/reference/rest/v1/users.labels';

function normalizeHex(value: string): string {
  return value.trim().toLowerCase();
}

function assertAllowedHex(value: string, field: 'textColor' | 'backgroundColor'): string {
  const normalized = normalizeHex(value);
  if (!ALLOWED_HEX_VALUES.has(normalized)) {
    throw new Error(
      `Invalid ${field} '${value}'. Gmail only accepts colors from its fixed ` +
        `palette. See ${GMAIL_PALETTE_DOC_URL} for the full list.`
    );
  }
  return normalized;
}

/**
 * Resolves a label color input to a validated {textColor, backgroundColor} pair.
 *
 * Accepts either:
 *   - A preset key (e.g. "blue") → looked up in GMAIL_LABEL_PALETTE
 *   - An explicit pair {textColor, backgroundColor} → each value must be in
 *     ALLOWED_HEX_VALUES (case-insensitive; returned lowercase)
 *
 * Throws on any validation failure.
 */
export function resolveLabelColor(input: string | LabelColorPair): LabelColorPair {
  if (typeof input === 'string') {
    const preset = GMAIL_LABEL_PALETTE[input as LabelColorPreset];
    if (!preset) {
      const validKeys = Object.keys(GMAIL_LABEL_PALETTE).join(', ');
      throw new Error(
        `Unknown color preset '${input}'. Valid presets: ${validKeys}. ` +
          `Or pass an explicit {textColor, backgroundColor} pair.`
      );
    }
    return { textColor: preset.textColor, backgroundColor: preset.backgroundColor };
  }

  return {
    textColor: assertAllowedHex(input.textColor, 'textColor'),
    backgroundColor: assertAllowedHex(input.backgroundColor, 'backgroundColor'),
  };
}
