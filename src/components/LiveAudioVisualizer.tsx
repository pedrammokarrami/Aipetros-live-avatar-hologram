import { useEffect, useRef } from 'react';
import { Square } from 'lucide-react';
import type { HologramAudioEngine } from '../utils/audioEngine';
import type { HologramVisualMood, PipelinePhase } from '../types/voicePersona';

interface LiveAudioVisualizerProps {
  audioEngine: HologramAudioEngine;
  phase: PipelinePhase;
  visualMood: HologramVisualMood;
  languageLabel: string;
  isRtl: boolean;
  isSoftwareGl: boolean;
  onInterrupt: () => void;
}

const BAR_COUNT = 16;

export function LiveAudioVisualizer({
  audioEngine,
  phase,
  visualMood,
  languageLabel,
  isRtl,
  isSoftwareGl,
  onInterrupt,
}: LiveAudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const moodRef = useRef(visualMood);
  moodRef.current = visualMood;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let timerId = 0;
    let disposed = false;
    const start = performance.now();

    const draw = () => {
      if (disposed) return;
      const t = (performance.now() - start) / 1000;
      const curPhase = phaseRef.current;
      const isListening = curPhase === 'listening' || curPhase === 'barge_in';
      const bars = barsRef.current;

      audioEngine.sampleWaveformBars(bars, t, isListening);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const gap = 3;
      const barW = Math.max(2, (w - gap * (BAR_COUNT - 1)) / BAR_COUNT);
      const accent =
        curPhase === 'barge_in'
          ? '#fb7185'
          : curPhase === 'thinking'
            ? '#93c5fd'
            : moodRef.current.accentHex;

      for (let i = 0; i < BAR_COUNT; i++) {
        const val = bars[i];
        const barH = Math.max(3, val * (h - 2));
        const x = i * (barW + gap);
        const y = (h - barH) / 2;

        ctx.fillStyle = accent;
        ctx.globalAlpha = curPhase === 'idle' ? 0.35 + val * 0.4 : 0.65 + val * 0.35;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (isSoftwareGl) {
        timerId = window.setTimeout(() => {
          rafId = window.requestAnimationFrame(draw);
        }, 70);
      } else {
        rafId = window.requestAnimationFrame(draw);
      }
    };

    rafId = window.requestAnimationFrame(draw);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
    };
  }, [audioEngine, isSoftwareGl]);

  const stateLabel =
    phase === 'listening'
      ? isRtl
        ? 'در حال شنیدن'
        : 'Listening'
      : phase === 'barge_in'
        ? isRtl
          ? 'قطع شد · گوش می‌دهد'
          : 'Barge-in'
        : phase === 'thinking'
          ? isRtl
            ? 'در حال پردازش'
            : 'Thinking'
          : phase === 'speaking'
            ? isRtl
              ? 'در حال صحبت'
              : 'Speaking'
            : isRtl
              ? 'آماده'
              : visualMood.label;

  return (
    <div
      className="pointer-events-auto flex items-center gap-3 px-2 py-0.5 text-[11px] text-cyan-100/75"
      aria-live="polite"
    >
      <span
        className={`font-medium tracking-wide ${isRtl ? 'font-bilingual-rtl' : ''}`}
        style={{ color: phase === 'barge_in' ? '#fda4af' : visualMood.accentHex }}
      >
        {stateLabel}
      </span>

      <canvas
        ref={canvasRef}
        width={96}
        height={20}
        aria-hidden="true"
        className="h-5 w-24 shrink-0"
      />

      <span className="hidden text-cyan-200/55 sm:inline">{languageLabel}</span>

      {(phase === 'speaking' || phase === 'thinking') && (
        <button
          type="button"
          onClick={onInterrupt}
          aria-label="Interrupt AI speech"
          className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-rose-400/20 px-2 py-0.5 text-[11px] font-medium text-rose-100 ring-1 ring-rose-300/40 transition-colors hover:bg-rose-400/35"
        >
          <Square className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
          <span>{isRtl ? 'توقف' : 'Stop'}</span>
        </button>
      )}
    </div>
  );
}
