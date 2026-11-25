import {
  DEFAULT_VOICE_PERSONA,
  type GeminiVoiceName,
  type PersonaAgeGroup,
  type PersonaGender,
  type PersonaLanguage,
  type PersonaTone,
  type PersianRegister,
  type VoicePersonaState,
} from '../types/voicePersona';

export interface HologramRuntimeConfig {
  /** Optional URL (relative path or https URL) to a .glb/.gltf model served via API. */
  glbUrl: string | null;
  /** Optional URL to a 3D projected dim background image. */
  backgroundUrl: string | null;
  /** Authoritative voice & persona settings supplied by the backend API. */
  voice: {
    language: PersonaLanguage;
    persianRegister: PersianRegister;
    gender: PersonaGender;
    age: PersonaAgeGroup;
    tone: PersonaTone;
    presetId: string;
    voiceName: GeminiVoiceName;
    pitch: number;
    speed: number;
    expressiveness: number;
  };
}

const VALID_LANGUAGES = new Set<PersonaLanguage>([
  'auto',
  'fa',
  'en',
  'ar',
  'es',
  'fr',
  'de',
  'ja',
  'ko',
  'tr',
  'ru',
  'zh',
  'hi',
]);
const VALID_REGISTERS = new Set<PersianRegister>(['natural_spoken', 'formal_literary']);
const VALID_GENDERS = new Set<PersonaGender>(['male', 'female', 'neutral']);
const VALID_AGES = new Set<PersonaAgeGroup>([
  'child_young',
  'young_adult',
  'middle_aged',
  'senior_wise',
]);
const VALID_TONES = new Set<PersonaTone>([
  'calm_empathetic',
  'energetic_enthusiastic',
  'tactical_serious',
  'storytelling_dramatic',
  'casual_friendly',
  'formal_executive',
]);
const VALID_VOICES = new Set<GeminiVoiceName>(['Charon', 'Fenrir', 'Kore', 'Puck', 'Zephyr']);

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

export function sanitizeAssetUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizeRuntimeConfig(raw: unknown): HologramRuntimeConfig {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawVoice = (obj.voice && typeof obj.voice === 'object' ? obj.voice : {}) as Record<
    string,
    unknown
  >;

  const language = VALID_LANGUAGES.has(rawVoice.language as PersonaLanguage)
    ? (rawVoice.language as PersonaLanguage)
    : DEFAULT_VOICE_PERSONA.language;

  const persianRegister = VALID_REGISTERS.has(rawVoice.persianRegister as PersianRegister)
    ? (rawVoice.persianRegister as PersianRegister)
    : DEFAULT_VOICE_PERSONA.persianRegister;

  const gender = VALID_GENDERS.has(rawVoice.gender as PersonaGender)
    ? (rawVoice.gender as PersonaGender)
    : DEFAULT_VOICE_PERSONA.gender;

  const age = VALID_AGES.has(rawVoice.age as PersonaAgeGroup)
    ? (rawVoice.age as PersonaAgeGroup)
    : DEFAULT_VOICE_PERSONA.age;

  const tone = VALID_TONES.has(rawVoice.tone as PersonaTone)
    ? (rawVoice.tone as PersonaTone)
    : DEFAULT_VOICE_PERSONA.tone;

  const voiceName = VALID_VOICES.has(rawVoice.voiceName as GeminiVoiceName)
    ? (rawVoice.voiceName as GeminiVoiceName)
    : 'Fenrir';

  const presetId =
    typeof rawVoice.presetId === 'string' && rawVoice.presetId.trim().length > 0
      ? rawVoice.presetId.trim()
      : DEFAULT_VOICE_PERSONA.presetId;

  return {
    glbUrl: sanitizeAssetUrl(obj.glbUrl),
    backgroundUrl:
      sanitizeAssetUrl(obj.backgroundUrl) ?? '/src/assets/images/cs2_world_backdrop_1795601005197.jpg',
    voice: {
      language,
      persianRegister,
      gender,
      age,
      tone,
      presetId,
      voiceName,
      pitch: clampNumber(rawVoice.pitch, 0.75, 1.3, DEFAULT_VOICE_PERSONA.pitch),
      speed: clampNumber(rawVoice.speed, 0.75, 1.35, DEFAULT_VOICE_PERSONA.speed),
      expressiveness: clampNumber(
        rawVoice.expressiveness,
        0.1,
        1.0,
        DEFAULT_VOICE_PERSONA.expressiveness,
      ),
    },
  };
}

export function applyRuntimeConfigToPersona(
  base: VoicePersonaState,
  config: HologramRuntimeConfig,
): VoicePersonaState {
  return {
    ...base,
    language: config.voice.language,
    persianRegister: config.voice.persianRegister,
    gender: config.voice.gender,
    age: config.voice.age,
    tone: config.voice.tone,
    presetId: config.voice.presetId,
    pitch: config.voice.pitch,
    speed: config.voice.speed,
    expressiveness: config.voice.expressiveness,
  };
}

/**
 * Computes eased bottom-to-top particle assembly progress in [0, 1].
 * Smooth cubic-out rise during opening (~2.2s) and brisk collapse (~0.75s) when closing.
 */
export function advanceAssemblyProgress(
  current: number,
  targetOpen: boolean,
  dt: number,
  openDurationSec = 2.2,
  closeDurationSec = 0.75,
): number {
  const safeDt = Math.max(0, Math.min(0.1, dt));
  if (targetOpen) {
    return Math.min(1, current + safeDt / Math.max(0.1, openDurationSec));
  }
  return Math.max(0, current - safeDt / Math.max(0.1, closeDurationSec));
}

export function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutSine(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return -(Math.cos(Math.PI * x) - 1) / 2;
}
