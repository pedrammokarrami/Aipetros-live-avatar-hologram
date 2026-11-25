export type PersonaLanguage =
  | 'auto'
  | 'fa'
  | 'en'
  | 'ar'
  | 'es'
  | 'fr'
  | 'de'
  | 'ja'
  | 'ko'
  | 'tr'
  | 'ru'
  | 'zh'
  | 'hi';

export type ResolvedLanguage = Exclude<PersonaLanguage, 'auto'>;

export type PersonaGender = 'male' | 'female' | 'neutral';

export type PersonaAgeGroup =
  | 'child_young'
  | 'young_adult'
  | 'middle_aged'
  | 'senior_wise';

export type PersonaTone =
  | 'calm_empathetic'
  | 'energetic_enthusiastic'
  | 'tactical_serious'
  | 'storytelling_dramatic'
  | 'casual_friendly'
  | 'formal_executive';

export type PersianRegister = 'natural_spoken' | 'formal_literary';

export type GeminiVoiceName = 'Charon' | 'Fenrir' | 'Kore' | 'Puck' | 'Zephyr';

export type TtsEngineId =
  | 'auto'
  | 'cosyvoice2'
  | 'f5-tts-persian'
  | 'xtts-v2-parsvoice'
  | 'piper-onnx'
  | 'browser-speech';

export type SttEngineId =
  | 'faster-whisper-large-v3-turbo'
  | 'gemini-3.5-transcribe'
  | 'browser-webspeech';

export type LlmEngineId = 'gemini-4-hydrogen' | 'qwen-2.5-72b' | 'gemma-3-27b';

export type OrchestratorTransport = 'builtin-gemini' | 'pipecat-ws' | 'livekit-rtc';

export type PipelinePhase = 'idle' | 'listening' | 'barge_in' | 'thinking' | 'speaking';

export interface LanguageMetadata {
  id: PersonaLanguage;
  label: string;
  nativeLabel: string;
  speechLocale: string;
  rtl: boolean;
}

export interface VoicePresetProfile {
  id: string;
  name: string;
  summary: string;
  geminiVoice: GeminiVoiceName;
  recommendedOpenSource: Exclude<TtsEngineId, 'auto' | 'browser-speech'>;
  defaultGender: PersonaGender;
  defaultAge: PersonaAgeGroup;
  defaultTone: PersonaTone;
  pitch: number;
  speed: number;
  expressiveness: number;
}

export interface ReferenceAudioSample {
  fileName: string;
  mimeType: string;
  durationSec: number;
  objectUrl: string;
  source: 'upload' | 'recording';
}

export interface OpenSourcePipelineConfig {
  transport: OrchestratorTransport;
  endpointUrl: string;
  sttEngine: SttEngineId;
  llmEngine: LlmEngineId;
  ttsEngine: TtsEngineId;
  vadEnabled: boolean;
  bargeInEnabled: boolean;
  vadThreshold: number;
}

export interface VoicePersonaState {
  language: PersonaLanguage;
  persianRegister: PersianRegister;
  gender: PersonaGender;
  age: PersonaAgeGroup;
  tone: PersonaTone;
  presetId: string;
  pitch: number;
  speed: number;
  expressiveness: number;
  referenceAudio: ReferenceAudioSample | null;
  pipeline: OpenSourcePipelineConfig;
}

export interface HologramVisualMood {
  /** RGB values in 0..1 for custom GLSL shader uniforms */
  deepColor: [number, number, number];
  midColor: [number, number, number];
  coreColor: [number, number, number];
  /** Particle orbital dispersion intensity (0.6..1.8) */
  dispersion: number;
  /** Scanline vertical velocity multiplier (0.7..2.2) */
  scanSpeed: number;
  /** CSS accent hex for subtle UI state focus alignment */
  accentHex: string;
  label: string;
}

export interface TtsRoutingPlan {
  primaryEngine: Exclude<TtsEngineId, 'auto'>;
  fallbackChain: Exclude<TtsEngineId, 'auto'>[];
  geminiVoice: GeminiVoiceName;
  styleDirective: string;
  usesZeroShotCloning: boolean;
}

export const SUPPORTED_LANGUAGES: LanguageMetadata[] = [
  { id: 'auto', label: 'Auto-Detect', nativeLabel: 'Auto', speechLocale: 'en-US', rtl: false },
  { id: 'fa', label: 'Persian', nativeLabel: 'فارسی', speechLocale: 'fa-IR', rtl: true },
  { id: 'en', label: 'English', nativeLabel: 'English', speechLocale: 'en-US', rtl: false },
  { id: 'ar', label: 'Arabic', nativeLabel: 'العربية', speechLocale: 'ar-SA', rtl: true },
  { id: 'es', label: 'Spanish', nativeLabel: 'Español', speechLocale: 'es-ES', rtl: false },
  { id: 'fr', label: 'French', nativeLabel: 'Français', speechLocale: 'fr-FR', rtl: false },
  { id: 'de', label: 'German', nativeLabel: 'Deutsch', speechLocale: 'de-DE', rtl: false },
  { id: 'ja', label: 'Japanese', nativeLabel: '日本語', speechLocale: 'ja-JP', rtl: false },
  { id: 'ko', label: 'Korean', nativeLabel: '한국어', speechLocale: 'ko-KR', rtl: false },
  { id: 'tr', label: 'Turkish', nativeLabel: 'Türkçe', speechLocale: 'tr-TR', rtl: false },
  { id: 'ru', label: 'Russian', nativeLabel: 'Русский', speechLocale: 'ru-RU', rtl: false },
  { id: 'zh', label: 'Chinese', nativeLabel: '中文', speechLocale: 'zh-CN', rtl: false },
  { id: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', speechLocale: 'hi-IN', rtl: false },
];

export const VOICE_PRESETS: VoicePresetProfile[] = [
  {
    id: 'vanguard-ops',
    name: 'Vanguard Ops',
    summary: 'Deep, crisp tactical briefing voice',
    geminiVoice: 'Fenrir',
    recommendedOpenSource: 'cosyvoice2',
    defaultGender: 'male',
    defaultAge: 'middle_aged',
    defaultTone: 'tactical_serious',
    pitch: 0.94,
    speed: 1.0,
    expressiveness: 0.55,
  },
  {
    id: 'pars-companion',
    name: 'Pars Companion',
    summary: 'Warm natural Persian & multilingual voice',
    geminiVoice: 'Kore',
    recommendedOpenSource: 'f5-tts-persian',
    defaultGender: 'female',
    defaultAge: 'young_adult',
    defaultTone: 'calm_empathetic',
    pitch: 1.02,
    speed: 0.98,
    expressiveness: 0.68,
  },
  {
    id: 'nova-spark',
    name: 'Nova Spark',
    summary: 'Bright energetic conversational delivery',
    geminiVoice: 'Puck',
    recommendedOpenSource: 'cosyvoice2',
    defaultGender: 'neutral',
    defaultAge: 'young_adult',
    defaultTone: 'energetic_enthusiastic',
    pitch: 1.08,
    speed: 1.08,
    expressiveness: 0.85,
  },
  {
    id: 'atlas-mentor',
    name: 'Atlas Mentor',
    summary: 'Measured resonant storyteller cadence',
    geminiVoice: 'Charon',
    recommendedOpenSource: 'xtts-v2-parsvoice',
    defaultGender: 'male',
    defaultAge: 'senior_wise',
    defaultTone: 'storytelling_dramatic',
    pitch: 0.88,
    speed: 0.92,
    expressiveness: 0.78,
  },
  {
    id: 'zephyr-edge',
    name: 'Zephyr Edge',
    summary: 'Ultra-low-latency neutral executive clarity',
    geminiVoice: 'Zephyr',
    recommendedOpenSource: 'piper-onnx',
    defaultGender: 'neutral',
    defaultAge: 'middle_aged',
    defaultTone: 'formal_executive',
    pitch: 1.0,
    speed: 1.03,
    expressiveness: 0.45,
  },
];

export const DEFAULT_VOICE_PERSONA: VoicePersonaState = {
  language: 'auto',
  persianRegister: 'natural_spoken',
  gender: 'male',
  age: 'middle_aged',
  tone: 'tactical_serious',
  presetId: 'vanguard-ops',
  pitch: 0.96,
  speed: 1.0,
  expressiveness: 0.62,
  referenceAudio: null,
  pipeline: {
    transport: 'builtin-gemini',
    endpointUrl: 'ws://localhost:8765/pipecat',
    sttEngine: 'faster-whisper-large-v3-turbo',
    llmEngine: 'gemini-4-hydrogen',
    ttsEngine: 'auto',
    vadEnabled: true,
    bargeInEnabled: true,
    vadThreshold: 0.14,
  },
};
