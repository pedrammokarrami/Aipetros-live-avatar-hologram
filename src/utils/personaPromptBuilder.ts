import {
  SUPPORTED_LANGUAGES,
  VOICE_PRESETS,
  type GeminiVoiceName,
  type HologramVisualMood,
  type PersonaAgeGroup,
  type PersonaGender,
  type PersonaLanguage,
  type PersonaTone,
  type ResolvedLanguage,
  type TtsEngineId,
  type TtsRoutingPlan,
  type VoicePersonaState,
} from '../types/voicePersona';

const PERSIAN_SPECIFIC_REGEX = /[پچژگکی]/g;
const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const JAPANESE_REGEX = /[\u3040-\u30FF]/g;
const KOREAN_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF]/g;
const CJK_REGEX = /[\u4E00-\u9FFF]/g;
const CYRILLIC_REGEX = /[\u0400-\u04FF]/g;
const DEVANAGARI_REGEX = /[\u0900-\u097F]/g;
const TURKISH_REGEX = /[ğĞşŞıİçÇöÖüÜ]/g;
const GERMAN_REGEX = /[äöüßÄÖÜ]/g;
const FRENCH_REGEX = /[éèêëàâùûôîçœæ]/gi;
const SPANISH_REGEX = /[ñÑ¿¡áéíóú]/gi;

export function isRtlLanguage(lang: PersonaLanguage | ResolvedLanguage): boolean {
  return lang === 'fa' || lang === 'ar';
}

export function getLanguageMeta(lang: PersonaLanguage) {
  return SUPPORTED_LANGUAGES.find((item) => item.id === lang) ?? SUPPORTED_LANGUAGES[0];
}

/**
 * Detects the active language from user text across Persian, Arabic, CJK, Cyrillic,
 * Hindi, Turkish, European languages, and English — respecting explicit user overrides.
 */
export function detectMultilingualLanguage(
  text: string,
  preferred: PersonaLanguage = 'auto',
  fallback: ResolvedLanguage = 'en',
): ResolvedLanguage {
  if (preferred !== 'auto') {
    return preferred;
  }

  const trimmed = text.trim();
  if (!trimmed) return fallback;

  const arabicScriptCount = trimmed.match(ARABIC_SCRIPT_REGEX)?.length ?? 0;
  if (arabicScriptCount > 0) {
    const persianChars = trimmed.match(PERSIAN_SPECIFIC_REGEX)?.length ?? 0;
    const persianWordHint = /(سلام|چطوری|ممنون|می‌?خوام|هست|نیست|بگو|لطفاً|فارسی|کجا|چرا|آواتار)/u.test(trimmed);
    const arabicWordHint = /(مرحبا|أهلا|كيف|شكرا|العربية|ماذا|أريد)/u.test(trimmed);
    if (persianChars > 0 || (persianWordHint && !arabicWordHint)) return 'fa';
    if (arabicWordHint && !persianWordHint) return 'ar';
    return fallback === 'ar' ? 'ar' : 'fa';
  }

  if ((trimmed.match(JAPANESE_REGEX)?.length ?? 0) > 0) return 'ja';
  if ((trimmed.match(KOREAN_REGEX)?.length ?? 0) > 0) return 'ko';
  if ((trimmed.match(CJK_REGEX)?.length ?? 0) > 0) return 'zh';
  if ((trimmed.match(CYRILLIC_REGEX)?.length ?? 0) > 0) return 'ru';
  if ((trimmed.match(DEVANAGARI_REGEX)?.length ?? 0) > 0) return 'hi';
  if ((trimmed.match(TURKISH_REGEX)?.length ?? 0) >= 2 || /\b(merhaba|nasılsın|teşekkür)\b/i.test(trimmed)) {
    return 'tr';
  }
  if ((trimmed.match(GERMAN_REGEX)?.length ?? 0) >= 2 || /\b(hallo|danke|bitte|wie geht)\b/i.test(trimmed)) {
    return 'de';
  }
  if ((trimmed.match(FRENCH_REGEX)?.length ?? 0) >= 2 || /\b(bonjour|merci|comment ça va)\b/i.test(trimmed)) {
    return 'fr';
  }
  if ((trimmed.match(SPANISH_REGEX)?.length ?? 0) >= 2 || /\b(hola|gracias|buenos días)\b/i.test(trimmed)) {
    return 'es';
  }

  return fallback;
}

const GENDER_PROMPT_MAP: Record<PersonaGender, string> = {
  male: 'Adopt a grounded masculine vocal persona and natural phrasing.',
  female: 'Adopt a poised feminine vocal persona and natural phrasing.',
  neutral: 'Adopt a balanced, gender-neutral, modern vocal persona.',
};

const AGE_PROMPT_MAP: Record<PersonaAgeGroup, string> = {
  child_young: 'Use bright, curious, youthful energy and simple, clear vocabulary suitable for a young speaker.',
  young_adult: 'Speak with contemporary, nimble, relatable young-adult rhythm and modern expressions.',
  middle_aged: 'Speak with seasoned, steady, articulate middle-aged authority and clarity.',
  senior_wise: 'Speak with unhurried, reflective, wise elder warmth, thoughtful pauses, and rich perspective.',
};

const TONE_PROMPT_MAP: Record<PersonaTone, string> = {
  calm_empathetic: 'Tone: calm, soothing, deeply empathetic, reassuring, and gentle.',
  energetic_enthusiastic: 'Tone: upbeat, vibrant, motivating, enthusiastic, and dynamic.',
  tactical_serious: 'Tone: focused, crisp, tactical, composed, and mission-oriented without unnecessary fluff.',
  storytelling_dramatic: 'Tone: evocative, atmospheric, dramatic storyteller with vivid imagery and cadence.',
  casual_friendly: 'Tone: relaxed, approachable, warm, and conversational like a trusted friend.',
  formal_executive: 'Tone: polished, executive, structured, diplomatic, and concise.',
};

/**
 * Generates a dynamic system prompt conditioning any streaming LLM (Gemini, Qwen 2.5, Gemma)
 * on Language, Persian register, Gender, Age Group, Tone/Emotion, and voice-first brevity.
 */
export function buildDynamicPersonaSystemPrompt(
  persona: VoicePersonaState,
  resolvedLanguage: ResolvedLanguage,
): string {
  const langMeta = getLanguageMeta(resolvedLanguage);
  const persianClause =
    resolvedLanguage === 'fa'
      ? persona.persianRegister === 'natural_spoken'
        ? 'Speak in natural, warm, contemporary spoken Tehran Persian (محاوره‌ای طبیعی و روان), avoiding stiff robotic bookish phrasing unless asked.'
        : 'Speak in refined, polished formal Persian (فارسی معیار و رسمی) with clean literary diction.'
      : `Respond naturally and idiomatically in ${langMeta.label} (${langMeta.nativeLabel}).`;

  const expressivenessClause =
    persona.expressiveness >= 0.72
      ? 'Use expressive natural rhythm and vivid conversational emphasis.'
      : persona.expressiveness <= 0.35
        ? 'Keep delivery restrained, steady, and matter-of-fact.'
        : 'Maintain balanced, natural spoken expressiveness.';

  return [
    'You are Aether, a real-time 3D holographic voice AI companion designed for low-latency spoken conversation.',
    'Format strictly for natural speech: keep replies concise (1 to 3 crisp sentences, typically under 50 words), plain spoken prose with zero markdown, asterisks, bullet points, or emojis.',
    persianClause,
    GENDER_PROMPT_MAP[persona.gender],
    AGE_PROMPT_MAP[persona.age],
    TONE_PROMPT_MAP[persona.tone],
    expressivenessClause,
    'If the user shares an image or visual context, describe or answer directly based on what is visible.',
  ].join(' ');
}

function selectGeminiVoice(
  gender: PersonaGender,
  age: PersonaAgeGroup,
  tone: PersonaTone,
  presetId: string,
): GeminiVoiceName {
  if (gender === 'female') {
    return tone === 'energetic_enthusiastic' || age === 'child_young' ? 'Zephyr' : 'Kore';
  }
  if (gender === 'male') {
    if (tone === 'tactical_serious') return 'Fenrir';
    if (age === 'senior_wise' || tone === 'storytelling_dramatic') return 'Charon';
    if (tone === 'energetic_enthusiastic' || age === 'child_young') return 'Puck';
    return 'Fenrir';
  }
  if (tone === 'energetic_enthusiastic') return 'Puck';
  if (tone === 'calm_empathetic') return 'Zephyr';
  const preset = VOICE_PRESETS.find((p) => p.id === presetId);
  return preset?.geminiVoice ?? 'Zephyr';
}

/**
 * Resolves the unified TTS routing plan mapping (language, gender, age, tone, referenceAudio)
 * to top open-source engines (CosyVoice 2, F5-TTS-Persian, XTTS-v2/ParsVoice, Piper ONNX)
 * plus the built-in Gemini neural voice & style directive.
 */
export function resolveTtsRoutingPlan(
  persona: VoicePersonaState,
  resolvedLanguage: ResolvedLanguage,
): TtsRoutingPlan {
  const usesZeroShotCloning = Boolean(persona.referenceAudio);
  let primaryEngine: Exclude<TtsEngineId, 'auto'>;

  if (persona.pipeline.ttsEngine !== 'auto') {
    primaryEngine = persona.pipeline.ttsEngine;
  } else if (resolvedLanguage === 'fa') {
    primaryEngine = usesZeroShotCloning ? 'xtts-v2-parsvoice' : 'f5-tts-persian';
  } else if (usesZeroShotCloning) {
    primaryEngine = 'cosyvoice2';
  } else if (persona.tone === 'formal_executive' && persona.expressiveness < 0.4) {
    primaryEngine = 'piper-onnx';
  } else {
    primaryEngine = 'cosyvoice2';
  }

  const allEngines: Exclude<TtsEngineId, 'auto'>[] = [
    'cosyvoice2',
    'f5-tts-persian',
    'xtts-v2-parsvoice',
    'piper-onnx',
    'browser-speech',
  ];
  const fallbackChain = allEngines.filter((e) => e !== primaryEngine);

  const langMeta = getLanguageMeta(resolvedLanguage);
  const ageDesc: Record<PersonaAgeGroup, string> = {
    child_young: 'youthful bright',
    young_adult: 'young adult',
    middle_aged: 'mature steady',
    senior_wise: 'older resonant wise',
  };
  const toneDesc: Record<PersonaTone, string> = {
    calm_empathetic: 'calm, gentle, empathetic',
    energetic_enthusiastic: 'energetic, lively, enthusiastic',
    tactical_serious: 'crisp, serious, tactical, focused',
    storytelling_dramatic: 'dramatic, expressive, theatrical storyteller',
    casual_friendly: 'relaxed, warm, friendly conversational',
    formal_executive: 'composed, clear, formal executive',
  };
  const paceDesc =
    persona.speed >= 1.12 ? 'brisk pacing' : persona.speed <= 0.88 ? 'unhurried pacing' : 'natural pacing';

  const styleDirective = `${toneDesc[persona.tone]} ${ageDesc[persona.age]} ${persona.gender} ${langMeta.label} voice with ${paceDesc}`;

  return {
    primaryEngine,
    fallbackChain,
    geminiVoice: selectGeminiVoice(persona.gender, persona.age, persona.tone, persona.presetId),
    styleDirective,
    usesZeroShotCloning,
  };
}

/**
 * Maps Tone/Emotion, Gender, Age, and Expressiveness to real-time 3D hologram particle palette,
 * orbital dispersion, and scanline energy so changing persona visibly transforms the soldier hologram.
 */
export function deriveHologramVisualMood(persona: VoicePersonaState): HologramVisualMood {
  const expr = Math.max(0, Math.min(1, persona.expressiveness));
  const ageSpeedOffset =
    persona.age === 'child_young'
      ? 0.25
      : persona.age === 'young_adult'
        ? 0.12
        : persona.age === 'senior_wise'
          ? -0.18
          : 0;

  const genderWarmth =
    persona.gender === 'female' ? 0.06 : persona.gender === 'neutral' ? 0.03 : 0;

  switch (persona.tone) {
    case 'energetic_enthusiastic':
      return {
        deepColor: [0.16 + genderWarmth, 0.72, 0.98],
        midColor: [0.38, 0.95, 0.88],
        coreColor: [1.0, 0.96, 0.84],
        dispersion: 1.28 + expr * 0.42,
        scanSpeed: Math.max(0.7, 1.65 + expr * 0.55 + ageSpeedOffset),
        accentHex: '#38f2d8',
        label: 'Energetic',
      };
    case 'calm_empathetic':
      return {
        deepColor: [0.06, 0.66 + genderWarmth * 0.6, 0.94],
        midColor: [0.36, 0.91, 0.98],
        coreColor: [0.90, 0.99, 1.0],
        dispersion: 0.78 + expr * 0.24,
        scanSpeed: Math.max(0.65, 0.88 + expr * 0.25 + ageSpeedOffset),
        accentHex: '#38bdf8',
        label: 'Calm',
      };
    case 'storytelling_dramatic':
      return {
        deepColor: [0.22 + genderWarmth, 0.52, 0.98],
        midColor: [0.56, 0.78, 1.0],
        coreColor: [0.96, 0.94, 1.0],
        dispersion: 1.15 + expr * 0.45,
        scanSpeed: Math.max(0.7, 1.22 + expr * 0.4 + ageSpeedOffset),
        accentHex: '#818cf8',
        label: 'Dramatic',
      };
    case 'casual_friendly':
      return {
        deepColor: [0.08 + genderWarmth, 0.78, 0.88],
        midColor: [0.42, 0.96, 0.94],
        coreColor: [0.95, 1.0, 0.98],
        dispersion: 1.02 + expr * 0.30,
        scanSpeed: Math.max(0.7, 1.18 + expr * 0.3 + ageSpeedOffset),
        accentHex: '#2dd4bf',
        label: 'Friendly',
      };
    case 'formal_executive':
      return {
        deepColor: [0.18, 0.68, 0.92],
        midColor: [0.64, 0.90, 1.0],
        coreColor: [0.98, 0.99, 1.0],
        dispersion: 0.72 + expr * 0.20,
        scanSpeed: Math.max(0.65, 0.96 + expr * 0.22 + ageSpeedOffset),
        accentHex: '#93c5fd',
        label: 'Executive',
      };
    case 'tactical_serious':
    default:
      return {
        deepColor: [0.06, 0.72, 0.99],
        midColor: [0.46 + genderWarmth, 0.95, 1.0],
        coreColor: [0.96, 1.0, 1.0],
        dispersion: 0.88 + expr * 0.30,
        scanSpeed: Math.max(0.75, 1.32 + expr * 0.35 + ageSpeedOffset),
        accentHex: '#22d3ee',
        label: 'Tactical',
      };
  }
}
