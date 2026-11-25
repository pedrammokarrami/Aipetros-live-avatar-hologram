export type SupportedLang = 'fa' | 'en';
export type TextDirection = 'rtl' | 'ltr';

// Persian / Arabic Unicode blocks
const PERSIAN_ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LATIN_REGEX = /[A-Za-z]/g;

/**
 * Detects whether text is primarily Persian (RTL) or English (LTR).
 * If any Persian/Arabic characters are present and at least 25% of letters are Persian,
 * treat as Persian so mixed technical terms inside Persian sentences stay RTL.
 */
export function detectLanguage(text: string, fallback: SupportedLang = 'en'): SupportedLang {
  const trimmed = text.trim();
  if (!trimmed) return fallback;

  const persianMatches = trimmed.match(PERSIAN_ARABIC_REGEX);
  const latinMatches = trimmed.match(LATIN_REGEX);

  const persianCount = persianMatches ? persianMatches.length : 0;
  const latinCount = latinMatches ? latinMatches.length : 0;

  if (persianCount === 0 && latinCount === 0) {
    return fallback;
  }

  if (persianCount > 0 && persianCount >= latinCount * 0.35) {
    return 'fa';
  }

  return 'en';
}

export function detectTextDirection(text: string, fallbackLang: SupportedLang = 'en'): TextDirection {
  return detectLanguage(text, fallbackLang) === 'fa' ? 'rtl' : 'ltr';
}

export function getSpeechLocale(lang: SupportedLang): 'fa-IR' | 'en-US' {
  return lang === 'fa' ? 'fa-IR' : 'en-US';
}

/**
 * Splits a spoken response into concise subtitle display segments so floating captions
 * remain crisp and never crowd the 3D hologram viewport.
 */
export function splitSubtitleSegments(text: string, maxChars = 110): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const rawSentences = clean
    .split(/(?<=[.!?؟۔\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const segments: string[] = [];
  for (const sentence of rawSentences) {
    if (sentence.length <= maxChars) {
      segments.push(sentence);
      continue;
    }

    const words = sentence.split(' ');
    let current = '';
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= maxChars) {
        current = `${current} ${word}`;
      } else {
        segments.push(current);
        current = word;
      }
    }
    if (current) segments.push(current);
  }

  return segments.length > 0 ? segments : [clean];
}
