import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceAssemblyProgress,
  applyRuntimeConfigToPersona,
  easeOutCubic,
  normalizeRuntimeConfig,
  sanitizeAssetUrl,
} from './hologramConfig';
import { DEFAULT_VOICE_PERSONA } from '../types/voicePersona';

test('sanitizeAssetUrl permits local paths and http(s) URLs while rejecting javascript URIs', () => {
  assert.equal(sanitizeAssetUrl('/models/avatar.glb'), '/models/avatar.glb');
  assert.equal(sanitizeAssetUrl('https://cdn.example.com/hero.glb'), 'https://cdn.example.com/hero.glb');
  assert.equal(sanitizeAssetUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeAssetUrl('//evil.example.com/x.glb'), null);
  assert.equal(sanitizeAssetUrl(''), null);
});

test('normalizeRuntimeConfig applies valid API overrides and clamps numeric voice fields', () => {
  const cfg = normalizeRuntimeConfig({
    glbUrl: 'https://cdn.example.com/agent.glb',
    backgroundUrl: '/assets/bg.jpg',
    voice: {
      language: 'fa',
      persianRegister: 'formal_literary',
      gender: 'female',
      age: 'young_adult',
      tone: 'calm_empathetic',
      voiceName: 'Kore',
      pitch: 2.5,
      speed: 0.2,
      expressiveness: 0.8,
    },
  });

  assert.equal(cfg.glbUrl, 'https://cdn.example.com/agent.glb');
  assert.equal(cfg.backgroundUrl, '/assets/bg.jpg');
  assert.equal(cfg.voice.language, 'fa');
  assert.equal(cfg.voice.gender, 'female');
  assert.equal(cfg.voice.voiceName, 'Kore');
  assert.equal(cfg.voice.pitch, 1.3);
  assert.equal(cfg.voice.speed, 0.75);

  const merged = applyRuntimeConfigToPersona(DEFAULT_VOICE_PERSONA, cfg);
  assert.equal(merged.language, 'fa');
  assert.equal(merged.tone, 'calm_empathetic');
  assert.equal(merged.pitch, 1.3);
});

test('advanceAssemblyProgress smoothly rises toward 1 on open and decays toward 0 on close', () => {
  let progress = 0;
  for (let i = 0; i < 25; i++) {
    progress = advanceAssemblyProgress(progress, true, 0.1, 2.0, 0.7);
  }
  assert.equal(progress, 1);

  const mid = advanceAssemblyProgress(0, true, 0.1, 2.0, 0.7);
  assert.ok(mid > 0 && mid < 0.2);
  assert.ok(easeOutCubic(0.5) > 0.5);

  let closing = 1;
  for (let i = 0; i < 10; i++) {
    closing = advanceAssemblyProgress(closing, false, 0.1, 2.0, 0.7);
  }
  assert.equal(closing, 0);
});
