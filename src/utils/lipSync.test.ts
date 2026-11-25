import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLipSyncMetrics,
  smoothLipSyncValue,
  synthesizeSpeechEnvelope,
} from './lipSync';

test('computeLipSyncMetrics returns zero on silence', () => {
  const freq = new Uint8Array(128).fill(0);
  const time = new Uint8Array(256).fill(128);
  const res = computeLipSyncMetrics(freq, time, 48000, 256);

  assert.equal(res.rms, 0);
  assert.equal(res.speechBandEnergy, 0);
  assert.equal(res.jawTarget, 0);
  assert.equal(res.glowTarget, 0);
});

test('computeLipSyncMetrics responds strongly to vowel speech-band frequencies', () => {
  const freq = new Uint8Array(128).fill(0);
  // 48000 / 256 = 187.5 Hz per bin -> bins 3..11 cover ~560Hz..2060Hz vowel formants
  for (let i = 3; i <= 11; i++) {
    freq[i] = 190;
  }
  const time = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    time[i] = Math.round(128 + 56 * Math.sin((i / 256) * Math.PI * 12));
  }

  const res = computeLipSyncMetrics(freq, time, 48000, 256);
  assert.ok(res.speechBandEnergy > 0.4, `Expected speechBandEnergy > 0.4, got ${res.speechBandEnergy}`);
  assert.ok(res.rms > 0.4, `Expected rms > 0.4, got ${res.rms}`);
  assert.ok(res.jawTarget > 0.5 && res.jawTarget <= 1);
  assert.ok(res.glowTarget > 0.5 && res.glowTarget <= 1);
});

test('smoothLipSyncValue rises faster on attack than it decays on release', () => {
  const dt = 0.016;
  const afterAttack = smoothLipSyncValue(0, 1, dt, 24, 8);
  const afterRelease = smoothLipSyncValue(1, 0, dt, 24, 8);
  const attackDelta = afterAttack;
  const releaseDelta = 1 - afterRelease;

  assert.ok(attackDelta > releaseDelta, 'Attack should be faster than release');
  assert.ok(afterAttack > 0 && afterAttack < 1);
  assert.ok(afterRelease > 0 && afterRelease < 1);
});

test('synthesizeSpeechEnvelope produces zero when silent and bounded motion when speaking', () => {
  const idle = synthesizeSpeechEnvelope(1.2, false, 0);
  assert.equal(idle.jawTarget, 0);
  assert.equal(idle.glowTarget, 0);

  const active = synthesizeSpeechEnvelope(1.2, true, 0.3);
  assert.ok(active.jawTarget > 0.1 && active.jawTarget <= 1);
  assert.ok(active.glowTarget > 0.1 && active.glowTarget <= 1);
});
