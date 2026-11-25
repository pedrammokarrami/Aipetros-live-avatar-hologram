export interface LipSyncMetrics {
  /** Time-domain root-mean-square loudness in [0, 1]. */
  rms: number;
  /** Energy concentrated in human speech formant bands (250Hz - 3200Hz) in [0, 1]. */
  speechBandEnergy: number;
  /** Target jaw openness in [0, 1] driven by vocal formants + amplitude. */
  jawTarget: number;
  /** Target holographic glow modulation in [0, 1]. */
  glowTarget: number;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Analyzes Web Audio AnalyserNode frequency and time-domain buffers to compute
 * real-time lip-sync jaw opening and cellular glow modulation.
 */
export function computeLipSyncMetrics(
  frequencyData: Uint8Array,
  timeDomainData: Uint8Array,
  sampleRate = 48000,
  fftSize = 256,
): LipSyncMetrics {
  if (frequencyData.length === 0 || timeDomainData.length === 0) {
    return { rms: 0, speechBandEnergy: 0, jawTarget: 0, glowTarget: 0 };
  }

  // 1. Time-domain RMS amplitude
  let sumSq = 0;
  for (let i = 0; i < timeDomainData.length; i++) {
    const centered = (timeDomainData[i] - 128) / 128;
    sumSq += centered * centered;
  }
  const rawRms = Math.sqrt(sumSq / timeDomainData.length);
  const rms = clamp01(rawRms * 3.4);

  // 2. Speech formant band energy (250Hz - 3200Hz)
  const binHz = sampleRate / Math.max(1, fftSize);
  const lowBin = Math.max(1, Math.floor(250 / binHz));
  const highBin = Math.min(frequencyData.length - 1, Math.ceil(3200 / binHz));

  let weightedSum = 0;
  let weightTotal = 0;
  for (let bin = lowBin; bin <= highBin; bin++) {
    const freq = bin * binHz;
    // Emphasize vowel F1/F2 formants (450Hz - 2100Hz) for expressive jaw movement
    const formantWeight = freq >= 450 && freq <= 2100 ? 1.35 : 0.75;
    weightedSum += (frequencyData[bin] / 255) * formantWeight;
    weightTotal += formantWeight;
  }

  const avgBand = weightTotal > 0 ? weightedSum / weightTotal : 0;
  // Subtle noise gate so silence settles cleanly to zero
  const gatedBand = Math.max(0, avgBand - 0.045) / 0.955;
  const speechBandEnergy = clamp01(gatedBand * 1.95);

  const jawTarget = clamp01(speechBandEnergy * 0.68 + rms * 0.48);
  const glowTarget = clamp01(speechBandEnergy * 0.55 + rms * 0.6);

  return {
    rms,
    speechBandEnergy,
    jawTarget,
    glowTarget,
  };
}

/**
 * Frame-rate-independent asymmetric attack/release smoother.
 * Fast attack catches plosives/syllable onsets; gentler release avoids jittery mouth flicker.
 */
export function smoothLipSyncValue(
  current: number,
  target: number,
  dt: number,
  attackRate = 22,
  releaseRate = 10,
): number {
  const safeDt = Math.max(0, Math.min(0.1, dt));
  const rate = target > current ? attackRate : releaseRate;
  const alpha = 1 - Math.exp(-rate * safeDt);
  return clamp01(current + (target - current) * alpha);
}

/**
 * Fallback syllable-synced envelope when native browser speechSynthesis is used
 * (since Web SpeechSynthesisUtterance cannot directly attach to a Web Audio AudioNode).
 */
export function synthesizeSpeechEnvelope(
  timeSec: number,
  speaking: boolean,
  boundaryBoost = 0,
): { jawTarget: number; glowTarget: number } {
  if (!speaking) {
    return { jawTarget: 0, glowTarget: 0 };
  }
  const syllableWave =
    0.42 +
    0.26 * Math.sin(timeSec * 14.5) +
    0.18 * Math.sin(timeSec * 23.1 + 1.1) +
    0.14 * Math.cos(timeSec * 8.3 + 0.5);
  const gated = Math.max(0.08, syllableWave);
  const jawTarget = clamp01(gated * 0.78 + boundaryBoost * 0.35);
  const glowTarget = clamp01(gated * 0.65 + boundaryBoost * 0.3);
  return { jawTarget, glowTarget };
}
