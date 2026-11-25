import {
  computeLipSyncMetrics,
  smoothLipSyncValue,
  synthesizeSpeechEnvelope,
} from './lipSync';
import { getLanguageMeta } from './personaPromptBuilder';
import type { ResolvedLanguage } from '../types/voicePersona';

export interface AudioPlaybackOptions {
  speed?: number;
  pitch?: number;
  lang?: ResolvedLanguage;
}

export interface LipSyncFrame {
  jawOpen: number;
  glowBoost: number;
  micLevel: number;
  isSpeaking: boolean;
  isMicActive: boolean;
}

/**
 * Coordinates real-time audio playback (Web Audio AudioBuffer routed through AnalyserNode),
 * live microphone input analysis (for VAD barge-in & hologram listening reactivity),
 * and multilingual browser SpeechSynthesis fallback — all without React 60Hz re-renders.
 */
export class HologramAudioEngine {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private freqBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(128));
  private timeBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(256));

  // Live microphone monitoring (Web Audio AnalyserNode for real-time VAD + hologram reactivity)
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micFreqBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(64));
  private micTimeBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(128));
  private micLevel = 0;
  private vadHighFrames = 0;
  private vadThreshold = 0.14;
  private onBargeInCallback: (() => void) | null = null;

  private mode: 'idle' | 'webaudio' | 'speechSynthesis' = 'idle';
  private jawOpen = 0;
  private glowBoost = 0;
  private boundaryPulse = 0;
  private synthClock = 0;
  private playbackToken = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.audioCtx) {
      this.audioCtx = new AudioCtx();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.62;
      this.freqBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.timeBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.analyser.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => {});
    }

    return this.audioCtx;
  }

  /** Unlocks Web Audio on the first user gesture (click / submit / mic press). */
  public unlock(): void {
    this.ensureContext();
  }

  public setVadConfig(threshold: number, onBargeIn: (() => void) | null): void {
    this.vadThreshold = Math.max(0.05, Math.min(0.5, threshold));
    this.onBargeInCallback = onBargeIn;
  }

  /**
   * Starts real-time microphone audio analysis for hologram reactivity and Silero-style
   * energy VAD barge-in detection. Fails silently if permission is denied so Web Speech still works.
   */
  public async startMicMonitor(): Promise<boolean> {
    if (this.micStream) return true;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }

    try {
      const ctx = this.ensureContext();
      if (!ctx) return false;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);

      this.micStream = stream;
      this.micSource = source;
      this.micAnalyser = analyser;
      this.micFreqBuffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.micTimeBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      this.vadHighFrames = 0;
      return true;
    } catch {
      return false;
    }
  }

  public stopMicMonitor(): void {
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.micSource = null;
    }
    this.micAnalyser = null;
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    this.micLevel = 0;
    this.vadHighFrames = 0;
  }

  public stop(): void {
    this.playbackToken += 1;
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // Source may already be stopped
      }
      this.currentSource = null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore synthesis cancel errors
      }
    }

    this.mode = 'idle';
    this.boundaryPulse = 0;
  }

  /**
   * Decodes and plays a base64 WAV audio clip via Web Audio API -> AnalyserNode,
   * applying user persona Speed & Pitch settings cleanly.
   */
  public async playBase64Audio(
    base64Audio: string,
    onProgress?: (ratio: number) => void,
    options: AudioPlaybackOptions = {},
  ): Promise<void> {
    this.stop();
    const token = ++this.playbackToken;

    const ctx = this.ensureContext();
    if (!ctx || !this.analyser) {
      throw new Error('Web Audio API is unavailable in this browser.');
    }

    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
    if (token !== this.playbackToken) return;

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    const rate = Math.max(0.75, Math.min(1.4, options.speed ?? 1.0));
    source.playbackRate.value = rate;
    if (typeof options.pitch === 'number' && Math.abs(options.pitch - 1.0) > 0.01) {
      // Shift pitch subtly in cents (-350..+350 cents) while preserving natural intelligibility
      const cents = Math.max(-350, Math.min(350, (options.pitch - 1.0) * 650));
      source.detune.value = cents;
    }
    source.connect(this.analyser);
    this.currentSource = source;
    this.mode = 'webaudio';

    const startTime = ctx.currentTime;
    const duration = Math.max(0.1, audioBuffer.duration / rate);

    let progressTimer: number | null = null;
    if (onProgress) {
      progressTimer = window.setInterval(() => {
        if (token !== this.playbackToken) {
          if (progressTimer !== null) clearInterval(progressTimer);
          return;
        }
        const elapsed = Math.max(0, ctx.currentTime - startTime);
        onProgress(Math.min(1, elapsed / duration));
      }, 120);
    }

    await new Promise<void>((resolve) => {
      source.onended = () => {
        if (progressTimer !== null) clearInterval(progressTimer);
        if (token === this.playbackToken) {
          this.currentSource = null;
          this.mode = 'idle';
          onProgress?.(1);
        }
        resolve();
      };
      source.start(0);
    });
  }

  /**
   * Speaks text via browser SpeechSynthesis in any supported language with word-boundary
   * lip-sync envelope and persona speed/pitch conditioning.
   */
  public async speakWithSpeechSynthesis(
    text: string,
    lang: ResolvedLanguage,
    onProgress?: (ratio: number) => void,
    options: AudioPlaybackOptions = {},
  ): Promise<void> {
    this.stop();
    const token = ++this.playbackToken;

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.mode = 'speechSynthesis';
      const durationMs = Math.min(8000, Math.max(1800, text.length * 60));
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const timer = window.setInterval(() => {
          if (token !== this.playbackToken) {
            clearInterval(timer);
            resolve();
            return;
          }
          const ratio = Math.min(1, (performance.now() - start) / durationMs);
          onProgress?.(ratio);
          if (ratio >= 1) {
            clearInterval(timer);
            this.mode = 'idle';
            resolve();
          }
        }, 90);
      });
      return;
    }

    const locale = getLanguageMeta(lang).speechLocale;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    utterance.rate = Math.max(0.7, Math.min(1.4, options.speed ?? (lang === 'fa' ? 0.96 : 1.0)));
    utterance.pitch = Math.max(0.65, Math.min(1.45, options.pitch ?? 1.0));

    const voices = window.speechSynthesis.getVoices();
    const matchingVoice =
      voices.find((v) => v.lang.toLowerCase() === locale.toLowerCase()) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(lang)) ||
      voices.find((v) => v.lang.toLowerCase().includes(lang));
    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    this.mode = 'speechSynthesis';
    this.synthClock = 0;

    const startedAt = performance.now();
    const minDurationMs = Math.min(4800, Math.max(1500, text.length * 44));

    await new Promise<void>((resolve) => {
      let finished = false;
      const estimatedDurationMs = Math.min(14000, Math.max(2200, text.length * 70));
      const safetyTimeout = window.setTimeout(() => {
        if (!finished) {
          finished = true;
          if (token === this.playbackToken) {
            this.mode = 'idle';
            onProgress?.(1);
          }
          resolve();
        }
      }, estimatedDurationMs + 1500);

      utterance.onboundary = (event) => {
        if (token !== this.playbackToken) return;
        this.boundaryPulse = 0.85;
        if (typeof event.charIndex === 'number' && text.length > 0) {
          onProgress?.(Math.min(1, event.charIndex / text.length));
        }
      };

      const finish = () => {
        if (finished) return;
        const elapsed = performance.now() - startedAt;
        if (elapsed < 350 && token === this.playbackToken) {
          const remaining = Math.max(600, minDurationMs - elapsed);
          const interval = window.setInterval(() => {
            if (token !== this.playbackToken) {
              clearInterval(interval);
              return;
            }
            const progress = Math.min(1, (performance.now() - startedAt) / minDurationMs);
            onProgress?.(progress);
          }, 100);
          window.setTimeout(() => {
            clearInterval(interval);
            if (!finished) {
              finished = true;
              clearTimeout(safetyTimeout);
              if (token === this.playbackToken) {
                this.mode = 'idle';
                onProgress?.(1);
              }
              resolve();
            }
          }, remaining);
          return;
        }
        finished = true;
        clearTimeout(safetyTimeout);
        if (token === this.playbackToken) {
          this.mode = 'idle';
          onProgress?.(1);
        }
        resolve();
      };

      utterance.onend = finish;
      utterance.onerror = finish;

      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Samples live AI output AND live microphone volume each render frame.
   * Triggers VAD barge-in callback immediately when user speaks over AI output.
   */
  public sample(dt: number): LipSyncFrame {
    let jawTarget = 0;
    let glowTarget = 0;

    if (this.mode === 'webaudio' && this.analyser && this.audioCtx) {
      this.analyser.getByteFrequencyData(this.freqBuffer);
      this.analyser.getByteTimeDomainData(this.timeBuffer);
      const metrics = computeLipSyncMetrics(
        this.freqBuffer,
        this.timeBuffer,
        this.audioCtx.sampleRate,
        this.analyser.fftSize,
      );
      jawTarget = metrics.jawTarget;
      glowTarget = metrics.glowTarget;
    } else if (this.mode === 'speechSynthesis') {
      this.synthClock += dt;
      this.boundaryPulse = Math.max(0, this.boundaryPulse - dt * 4.5);
      const env = synthesizeSpeechEnvelope(this.synthClock, true, this.boundaryPulse);
      jawTarget = env.jawTarget;
      glowTarget = env.glowTarget;
    }

    // Live microphone RMS volume + Silero-style hold-window VAD barge-in detection
    let rawMic = 0;
    if (this.micAnalyser) {
      this.micAnalyser.getByteTimeDomainData(this.micTimeBuffer);
      let sumSq = 0;
      for (let i = 0; i < this.micTimeBuffer.length; i++) {
        const centered = (this.micTimeBuffer[i] - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / this.micTimeBuffer.length);
      rawMic = Math.min(1, rms * 4.2);

      if (this.mode !== 'idle' && this.onBargeInCallback) {
        if (rawMic > this.vadThreshold) {
          this.vadHighFrames += 1;
          if (this.vadHighFrames >= 5) {
            this.vadHighFrames = 0;
            this.stop();
            this.onBargeInCallback();
          }
        } else {
          this.vadHighFrames = Math.max(0, this.vadHighFrames - 1);
        }
      } else {
        this.vadHighFrames = 0;
      }
    }

    this.jawOpen = smoothLipSyncValue(this.jawOpen, jawTarget, dt, 24, 11);
    this.glowBoost = smoothLipSyncValue(this.glowBoost, glowTarget, dt, 18, 8);
    this.micLevel = smoothLipSyncValue(this.micLevel, rawMic, dt, 22, 10);

    return {
      jawOpen: this.jawOpen,
      glowBoost: this.glowBoost,
      micLevel: this.micLevel,
      isSpeaking: this.mode !== 'idle',
      isMicActive: Boolean(this.micAnalyser),
    };
  }

  /**
   * Populates a small normalized waveform bar buffer (e.g. 16 bars) for the live audio
   * visualizer without allocating memory on every frame.
   */
  public sampleWaveformBars(out: Float32Array, timeSec: number, isListening: boolean): void {
    const n = out.length;
    if (this.mode === 'webaudio' && this.analyser) {
      this.analyser.getByteFrequencyData(this.freqBuffer);
      const step = Math.max(1, Math.floor((this.freqBuffer.length * 0.55) / n));
      for (let i = 0; i < n; i++) {
        const v = this.freqBuffer[Math.min(this.freqBuffer.length - 1, i * step + 2)] / 255;
        out[i] = Math.max(0.08, Math.min(1, v * 1.25));
      }
      return;
    }

    if (this.micAnalyser && isListening) {
      this.micAnalyser.getByteFrequencyData(this.micFreqBuffer);
      const step = Math.max(1, Math.floor((this.micFreqBuffer.length * 0.65) / n));
      for (let i = 0; i < n; i++) {
        const v = this.micFreqBuffer[Math.min(this.micFreqBuffer.length - 1, i * step + 1)] / 255;
        out[i] = Math.max(0.1, Math.min(1, v * 1.45));
      }
      return;
    }

    if (this.mode === 'speechSynthesis') {
      const energy = Math.max(0.18, this.glowBoost);
      for (let i = 0; i < n; i++) {
        const centerWeight = 1 - Math.abs((i / (n - 1)) * 2 - 1) * 0.55;
        const wave = 0.5 + 0.5 * Math.sin(timeSec * 14 + i * 0.85);
        out[i] = Math.max(0.08, Math.min(1, energy * centerWeight * (0.45 + 0.55 * wave)));
      }
      return;
    }

    // Calm ambient idle wave
    const boost = isListening ? 0.34 : 0.12;
    for (let i = 0; i < n; i++) {
      const centerWeight = 1 - Math.abs((i / (n - 1)) * 2 - 1) * 0.65;
      const wave = 0.5 + 0.5 * Math.sin(timeSec * (isListening ? 6.5 : 2.2) + i * 0.55);
      out[i] = Math.max(0.06, boost * centerWeight * (0.45 + 0.55 * wave));
    }
  }

  public dispose(): void {
    this.stop();
    this.stopMicMonitor();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
      this.analyser = null;
    }
  }
}
