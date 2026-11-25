import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VOICE_PERSONA } from '../types/voicePersona';
import {
  buildDynamicPersonaSystemPrompt,
  deriveHologramVisualMood,
  detectMultilingualLanguage,
  isRtlLanguage,
  resolveTtsRoutingPlan,
} from './personaPromptBuilder';

test('detectMultilingualLanguage identifies Persian, Arabic, Japanese, Korean, and English cleanly', () => {
  assert.equal(detectMultilingualLanguage('سلام چطوری؟ وضعیت عملیات چطوره؟', 'auto'), 'fa');
  assert.equal(detectMultilingualLanguage('مرحبا كيف حالك اليوم', 'auto'), 'ar');
  assert.equal(detectMultilingualLanguage('こんにちは、元気ですか？', 'auto'), 'ja');
  assert.equal(detectMultilingualLanguage('안녕하세요 반갑습니다', 'auto'), 'ko');
  assert.equal(detectMultilingualLanguage('Status report on sector alpha.', 'auto'), 'en');
  // Explicit user override takes precedence
  assert.equal(detectMultilingualLanguage('Hello world', 'fa'), 'fa');
});

test('isRtlLanguage flags Persian and Arabic only', () => {
  assert.equal(isRtlLanguage('fa'), true);
  assert.equal(isRtlLanguage('ar'), true);
  assert.equal(isRtlLanguage('en'), false);
  assert.equal(isRtlLanguage('ja'), false);
});

test('buildDynamicPersonaSystemPrompt injects language, register, gender, age, and tone constraints', () => {
  const prompt = buildDynamicPersonaSystemPrompt(
    {
      ...DEFAULT_VOICE_PERSONA,
      language: 'fa',
      persianRegister: 'natural_spoken',
      gender: 'female',
      age: 'senior_wise',
      tone: 'calm_empathetic',
    },
    'fa',
  );

  assert.match(prompt, /spoken Tehran Persian/i);
  assert.match(prompt, /feminine/i);
  assert.match(prompt, /elder/i);
  assert.match(prompt, /empathetic/i);
});

test('resolveTtsRoutingPlan selects F5-TTS-Persian or XTTS-v2/ParsVoice for Persian and CosyVoice 2 for multilingual', () => {
  const persianDefault = resolveTtsRoutingPlan(
    { ...DEFAULT_VOICE_PERSONA, language: 'fa', referenceAudio: null },
    'fa',
  );
  assert.equal(persianDefault.primaryEngine, 'f5-tts-persian');
  assert.equal(persianDefault.usesZeroShotCloning, false);

  const persianCloned = resolveTtsRoutingPlan(
    {
      ...DEFAULT_VOICE_PERSONA,
      language: 'fa',
      referenceAudio: {
        fileName: 'sample.wav',
        mimeType: 'audio/wav',
        durationSec: 6.5,
        objectUrl: 'blob:test',
        source: 'recording',
      },
    },
    'fa',
  );
  assert.equal(persianCloned.primaryEngine, 'xtts-v2-parsvoice');
  assert.equal(persianCloned.usesZeroShotCloning, true);

  const englishEnergetic = resolveTtsRoutingPlan(
    { ...DEFAULT_VOICE_PERSONA, language: 'en', gender: 'female', tone: 'energetic_enthusiastic' },
    'en',
  );
  assert.equal(englishEnergetic.primaryEngine, 'cosyvoice2');
  assert.equal(englishEnergetic.geminiVoice, 'Zephyr');
});

test('deriveHologramVisualMood shifts energy and color between calm and energetic tones', () => {
  const calm = deriveHologramVisualMood({
    ...DEFAULT_VOICE_PERSONA,
    tone: 'calm_empathetic',
    age: 'senior_wise',
    expressiveness: 0.3,
  });
  const energetic = deriveHologramVisualMood({
    ...DEFAULT_VOICE_PERSONA,
    tone: 'energetic_enthusiastic',
    age: 'young_adult',
    expressiveness: 0.9,
  });

  assert.ok(energetic.dispersion > calm.dispersion, 'Energetic tone should have higher particle dispersion');
  assert.ok(energetic.scanSpeed > calm.scanSpeed, 'Energetic tone should scan faster than calm senior');
  assert.notEqual(energetic.accentHex, calm.accentHex);
});
