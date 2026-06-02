/**
 * Curated STT language list.
 *
 * `""` (the first entry) means "auto-detect" — the provider will pick
 * a language based on the audio. ElevenLabs Scribe accepts ISO 639-1
 * codes; we expose a curated subset of the most common ones to keep
 * the picker manageable.
 */

/** Sentinel for "let the provider auto-detect". We can't use "" as the
 *  picker value (Radix Select reserves it for "no selection"), so the
 *  STT route treats both "auto" and "" the same way internally. */
export const STT_LANGUAGE_AUTO = "auto";

export interface STTLanguage {
  /** ISO 639-1 code, or STT_LANGUAGE_AUTO. */
  code: string;
  label: string;
}

export const STT_LANGUAGES: readonly STTLanguage[] = [
  { code: STT_LANGUAGE_AUTO, label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "tr", label: "Turkish" },
  { code: "ar", label: "Arabic" },
  { code: "he", label: "Hebrew" },
  { code: "fa", label: "Persian" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "mr", label: "Marathi" },
  { code: "ml", label: "Malayalam" },
  { code: "kn", label: "Kannada" },
  { code: "gu", label: "Gujarati" },
  { code: "pa", label: "Punjabi" },
  { code: "ur", label: "Urdu" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "id", label: "Indonesian" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "cs", label: "Czech" },
  { code: "el", label: "Greek" },
  { code: "ro", label: "Romanian" },
  { code: "hu", label: "Hungarian" },
] as const;

export function isValidSTTLanguage(code: string): boolean {
  return STT_LANGUAGES.some((l) => l.code === code);
}
