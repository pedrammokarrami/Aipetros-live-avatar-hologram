import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Mic, MicOff, SendHorizontal, Sparkles, X } from 'lucide-react';
import { SoldierHologram } from './components/SoldierHologram';
import { HologramAudioEngine } from './utils/audioEngine';
import { loadGlbUrlToPointCloud } from './utils/glbLoader';
import { loadImageUrlToBackgroundCloud } from './utils/imageLoader';
import type { BackgroundPointCloudData } from './utils/backgroundPointCloud';
import { splitSubtitleSegments } from './utils/language';
import {
  DEFAULT_VOICE_PERSONA,
  type GeminiVoiceName,
  type PipelinePhase,
  type ResolvedLanguage,
  type VoicePersonaState,
} from './types/voicePersona';
import {
  deriveHologramVisualMood,
  detectMultilingualLanguage,
  getLanguageMeta,
  isRtlLanguage,
} from './utils/personaPromptBuilder';
import {
  applyRuntimeConfigToPersona,
  normalizeRuntimeConfig,
} from './utils/hologramConfig';
import {
  VoicePipelineService,
  type ConversationTurn,
} from './services/voicePipelineService';
import { generateProceduralTacticalSoldier, type PointCloudData } from './utils/pointCloud';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function getInitialOpenState(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('autostart') === '1';
}

export default function App() {
  const [isOpen, setIsOpen] = useState<boolean>(getInitialOpenState);
  const [isUiRevealed, setIsUiRevealed] = useState<boolean>(getInitialOpenState);

  const [pointCloud, setPointCloud] = useState<PointCloudData>(() =>
    generateProceduralTacticalSoldier({ maxPoints: 19500, minSpacing: 0.0128 }),
  );
  const [backgroundCloud, setBackgroundCloud] = useState<BackgroundPointCloudData | null>(null);
  const [modelMode, setModelMode] = useState<'placeholder' | 'glb'>('placeholder');

  const [persona, setPersona] = useState<VoicePersonaState>(DEFAULT_VOICE_PERSONA);
  const [apiVoiceName, setApiVoiceName] = useState<GeminiVoiceName | undefined>(undefined);
  const [isSoftwareGl, setIsSoftwareGl] = useState(false);

  const [inputText, setInputText] = useState('');
  const [phase, setPhase] = useState<PipelinePhase>('idle');
  const [bargeInPulseNonce, setBargeInPulseNonce] = useState(0);

  const [subtitleText, setSubtitleText] = useState('');
  const [subtitleLang, setSubtitleLang] = useState<ResolvedLanguage>('en');
  const [subtitleTone, setSubtitleTone] = useState<'speech' | 'interim' | 'error'>('speech');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const historyRef = useRef<ConversationTurn[]>([]);
  const subtitleHideTimerRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const personaRef = useRef(persona);
  personaRef.current = persona;
  const apiVoiceNameRef = useRef(apiVoiceName);
  apiVoiceNameRef.current = apiVoiceName;

  const audioEngine = useMemo(() => new HologramAudioEngine(), []);
  const pipelineService = useMemo(() => new VoicePipelineService(), []);
  const visualMood = useMemo(() => deriveHologramVisualMood(persona), [persona]);

  // Fetch authoritative Voice Persona + .GLB Hologram URL + 3D Backdrop URL from /api/config
  useEffect(() => {
    let cancelled = false;

    const loadApiConfig = async () => {
      try {
        const res = await fetch('/api/config');
        const raw = res.ok ? await res.json() : {};
        if (cancelled) return;

        const config = normalizeRuntimeConfig(raw);
        setPersona((prev) => applyRuntimeConfigToPersona(prev, config));
        setApiVoiceName(config.voice.voiceName);

        if (config.glbUrl) {
          void loadGlbUrlToPointCloud(config.glbUrl)
            .then((loaded) => {
              if (cancelled) return;
              setPointCloud(loaded.cloud);
              setModelMode('glb');
            })
            .catch(() => {
              // Keep procedural tactical soldier fallback cleanly if remote GLB fails
            });
        }

        if (config.backgroundUrl) {
          void loadImageUrlToBackgroundCloud(config.backgroundUrl, 'API Backdrop')
            .then((result) => {
              if (cancelled) return;
              setBackgroundCloud(result.cloud);
            })
            .catch(() => {
              // Optional backdrop — stage stays clean obsidian space-navy
            });
        }
      } catch {
        // Fallback to default CS2 dim 3D backdrop if /api/config is temporarily unreachable
        void loadImageUrlToBackgroundCloud(
          '/src/assets/images/cs2_world_backdrop_1795601005197.jpg',
          'CS2 World',
        )
          .then((result) => {
            if (!cancelled) setBackgroundCloud(result.cloud);
          })
          .catch(() => {});
      }
    };

    void loadApiConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  // Coordinate chat bar reveal timing with the bottom-to-top particle assembly wave
  useEffect(() => {
    if (revealTimerRef.current !== null) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    if (isOpen) {
      revealTimerRef.current = window.setTimeout(() => {
        setIsUiRevealed(true);
      }, 1150);
    } else {
      setIsUiRevealed(false);
    }

    return () => {
      if (revealTimerRef.current !== null) {
        clearTimeout(revealTimerRef.current);
      }
    };
  }, [isOpen]);

  // Wire Silero-style energy VAD barge-in into the audio engine
  useEffect(() => {
    audioEngine.setVadConfig(
      persona.pipeline.vadThreshold,
      persona.pipeline.vadEnabled && persona.pipeline.bargeInEnabled
        ? () => {
            pipelineService.interrupt();
            setBargeInPulseNonce((n) => n + 1);
            setPhase('barge_in');
          }
        : null,
    );
  }, [
    audioEngine,
    persona.pipeline.bargeInEnabled,
    persona.pipeline.vadEnabled,
    persona.pipeline.vadThreshold,
    pipelineService,
  ]);

  useEffect(() => {
    return () => {
      if (subtitleHideTimerRef.current !== null) clearTimeout(subtitleHideTimerRef.current);
      if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore cleanup errors
        }
      }
      pipelineService.interrupt();
      audioEngine.dispose();
    };
  }, [audioEngine, pipelineService]);

  const clearSubtitleTimer = useCallback(() => {
    if (subtitleHideTimerRef.current !== null) {
      clearTimeout(subtitleHideTimerRef.current);
      subtitleHideTimerRef.current = null;
    }
  }, []);

  const showTransientSubtitle = useCallback(
    (
      text: string,
      lang: ResolvedLanguage,
      tone: 'speech' | 'interim' | 'error',
      durationMs = 4200,
    ) => {
      clearSubtitleTimer();
      setSubtitleText(text);
      setSubtitleLang(lang);
      setSubtitleTone(tone);
      if (durationMs > 0) {
        subtitleHideTimerRef.current = window.setTimeout(() => {
          setSubtitleText('');
        }, durationMs);
      }
    },
    [clearSubtitleTimer],
  );

  const handleOpenExperience = useCallback(() => {
    audioEngine.unlock();
    setIsOpen(true);
  }, [audioEngine]);

  const handleCloseExperience = useCallback(() => {
    pipelineService.interrupt();
    audioEngine.stop();
    audioEngine.stopMicMonitor();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore abort errors
      }
      recognitionRef.current = null;
    }
    clearSubtitleTimer();
    setSubtitleText('');
    setPhase('idle');
    setIsOpen(false);
  }, [audioEngine, clearSubtitleTimer, pipelineService]);

  // Allow pressing Escape to collapse back to the single launch button
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseExperience();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCloseExperience, isOpen]);

  const speakReply = useCallback(
    async (
      replyText: string,
      lang: ResolvedLanguage,
      routingPlan: ReturnType<VoicePipelineService['sendTurn']> extends Promise<infer R>
        ? R extends { routingPlan: infer P }
          ? P
          : never
        : never,
    ) => {
      clearSubtitleTimer();
      const segments = splitSubtitleSegments(replyText, 115);
      setSubtitleLang(lang);
      setSubtitleTone('speech');
      setSubtitleText(segments[0] ?? replyText);
      setPhase('speaking');

      const updateSegmentByProgress = (ratio: number) => {
        if (segments.length <= 1) return;
        const idx = Math.min(segments.length - 1, Math.floor(ratio * segments.length));
        setSubtitleText(segments[idx]);
      };

      const curPersona = personaRef.current;

      try {
        const tts = await pipelineService.synthesizeSpeech({
          text: replyText,
          lang,
          persona: curPersona,
          routingPlan,
          voiceNameOverride: apiVoiceNameRef.current,
        });

        if (tts.audioBase64) {
          await audioEngine.playBase64Audio(tts.audioBase64, updateSegmentByProgress, {
            speed: curPersona.speed,
            pitch: curPersona.pitch,
            lang,
          });
          setPhase((cur) => (cur === 'speaking' ? 'idle' : cur));
          subtitleHideTimerRef.current = window.setTimeout(() => {
            setSubtitleText('');
          }, 2400);
          return;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
      }

      try {
        await audioEngine.speakWithSpeechSynthesis(replyText, lang, updateSegmentByProgress, {
          speed: curPersona.speed,
          pitch: curPersona.pitch,
          lang,
        });
      } finally {
        setPhase((cur) => (cur === 'speaking' ? 'idle' : cur));
        subtitleHideTimerRef.current = window.setTimeout(() => {
          setSubtitleText('');
        }, 2400);
      }
    },
    [audioEngine, clearSubtitleTimer, pipelineService],
  );

  const sendMessage = useCallback(
    async (rawText: string) => {
      const message = rawText.trim();
      if (!message) return;

      audioEngine.unlock();
      audioEngine.stop();
      pipelineService.interrupt();

      const detectedLang = detectMultilingualLanguage(
        message,
        personaRef.current.language,
        'en',
      );
      setInputText('');
      setPhase('thinking');
      showTransientSubtitle('Thinking...', 'en', 'interim', 0);

      try {
        const result = await pipelineService.sendTurn({
          message,
          history: historyRef.current,
          persona: personaRef.current,
        });

        historyRef.current = [
          ...historyRef.current.slice(-10),
          { role: 'user', text: message },
          { role: 'model', text: result.reply },
        ];

        await speakReply(result.reply, result.lang, result.routingPlan);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setPhase('idle');
          return;
        }
        setPhase('idle');
        const msg =
          err instanceof Error ? err.message : 'Unable to reach voice intelligence service.';
        showTransientSubtitle(msg, detectedLang, 'error', 5200);
      }
    },
    [audioEngine, pipelineService, showTransientSubtitle, speakReply],
  );

  const toggleMicrophone = useCallback(() => {
    audioEngine.unlock();

    const wasInterrupting = phase === 'speaking' || phase === 'thinking';
    if (wasInterrupting) {
      pipelineService.interrupt();
      audioEngine.stop();
      setBargeInPulseNonce((n) => n + 1);
    }

    if ((phase === 'listening' || phase === 'barge_in') && recognitionRef.current) {
      recognitionRef.current.stop();
      audioEngine.stopMicMonitor();
      setPhase('idle');
      return;
    }

    const RecognitionCtor = getSpeechRecognitionCtor();

    if (!RecognitionCtor) {
      showTransientSubtitle(
        'Live speech recognition is unavailable in this browser. Type your message below.',
        'en',
        'error',
        4800,
      );
      return;
    }

    if (personaRef.current.pipeline.vadEnabled) {
      void audioEngine.startMicMonitor();
    }

    const recognition = new RecognitionCtor();
    const chosenLang = personaRef.current.language === 'auto' ? 'en' : personaRef.current.language;
    recognition.lang = getLanguageMeta(chosenLang).speechLocale;
    recognition.continuous = false;
    recognition.interimResults = true;

    let finalTranscript = '';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      const preview = (finalTranscript || interim).trim();
      if (preview) {
        const previewLang = detectMultilingualLanguage(preview, personaRef.current.language, 'en');
        setInputText(preview);
        showTransientSubtitle(preview, previewLang, 'interim', 0);
      }
    };

    recognition.onerror = (event) => {
      audioEngine.stopMicMonitor();
      setPhase('idle');
      recognitionRef.current = null;
      if (event.error === 'aborted' || event.error === 'no-speech') {
        setSubtitleText('');
        return;
      }
      const message =
        event.error === 'not-allowed'
          ? 'Microphone permission was denied.'
          : 'Could not capture voice input. Please try again.';
      showTransientSubtitle(message, 'en', 'error', 4500);
    };

    recognition.onend = () => {
      audioEngine.stopMicMonitor();
      recognitionRef.current = null;
      const spoken = finalTranscript.trim();
      if (spoken) {
        void sendMessage(spoken);
      } else {
        setPhase('idle');
      }
    };

    try {
      recognitionRef.current = recognition;
      setPhase(wasInterrupting ? 'barge_in' : 'listening');
      showTransientSubtitle('Listening...', 'en', 'interim', 0);
      recognition.start();
    } catch {
      audioEngine.stopMicMonitor();
      setPhase('idle');
      recognitionRef.current = null;
      showTransientSubtitle('Unable to start microphone capture.', 'en', 'error', 4500);
    }
  }, [audioEngine, phase, pipelineService, sendMessage, showTransientSubtitle]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(inputText);
  };

  const detectedInputLang = inputText.trim()
    ? detectMultilingualLanguage(inputText, 'auto', 'en')
    : 'en';
  const inputDir = isRtlLanguage(detectedInputLang) ? 'rtl' : 'ltr';
  const subtitleDir = isRtlLanguage(subtitleLang) ? 'rtl' : 'ltr';
  const glassClass = isSoftwareGl ? 'liquid-glass' : 'liquid-glass gpu-glass';

  return (
    <div
      data-state={isOpen ? 'open' : 'collapsed'}
      className="relative h-dvh w-screen overflow-hidden bg-[#030a14] text-[#e6f7ff]"
    >
      {/* Full-Viewport 3D Hologram Stage with Bottom-to-Top Particle Assembly */}
      <SoldierHologram
        pointCloud={pointCloud}
        backgroundCloud={backgroundCloud}
        audioEngine={audioEngine}
        phase={phase}
        visualMood={visualMood}
        bargeInPulseNonce={bargeInPulseNonce}
        modelMode={modelMode}
        isOpen={isOpen}
        onSoftwareGlDetected={setIsSoftwareGl}
      />

      {/* Single Launch Button State — Entire Product Collapsed Into One Iconic Button */}
      <div
        aria-hidden={isOpen}
        className={`pointer-events-none fixed inset-x-0 bottom-10 z-20 flex flex-col items-center justify-center px-4 transition-all duration-500 ease-out sm:bottom-14 ${
          isOpen ? 'translate-y-4 scale-75 opacity-0' : 'translate-y-0 scale-100 opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={handleOpenExperience}
          data-testid="launch-hologram-btn"
          aria-label="Activate Aether Hologram"
          tabIndex={isOpen ? -1 : 0}
          className={`group relative flex cursor-pointer items-center gap-3 rounded-full px-6 py-3.5 text-sm font-medium tracking-[0.16em] text-cyan-50 transition-all duration-300 hover:scale-[1.04] hover:text-white active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300 ${
            isOpen ? 'pointer-events-none' : 'pointer-events-auto'
          } liquid-glass-cta ${isSoftwareGl ? '' : 'gpu-glass'}`}
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-300/20 text-cyan-200 ring-1 ring-cyan-200/50 transition-transform duration-300 group-hover:scale-110 group-hover:bg-cyan-300/30"
          >
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <span className="pr-1">AETHER</span>
        </button>
      </div>

      {/* Minimal Whisper-Quiet Collapse Control When Expanded (Zero Settings UI) */}
      {isOpen && (
        <button
          type="button"
          onClick={handleCloseExperience}
          data-testid="close-hologram-btn"
          aria-label="Minimize hologram"
          className={`fixed top-4 right-4 z-20 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-cyan-200/55 transition-all duration-300 hover:bg-cyan-300/14 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-300 sm:top-5 sm:right-6 ${
            isUiRevealed ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <X className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      )}

      {/* Expanded Bottom Interaction Stack — ONLY Subtitles + Voice & Text Chat Capsule */}
      <div
        aria-hidden={!isUiRevealed}
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2.5 px-3 pb-4 transition-all duration-700 ease-out sm:px-6 sm:pb-6 ${
          isUiRevealed
            ? 'translate-y-0 opacity-100'
            : 'translate-y-6 opacity-0'
        }`}
      >
        {/* Clean Floating Subtitles */}
        {isOpen && subtitleText && (
          <div
            data-testid="floating-subtitle"
            dir={subtitleDir}
            role="status"
            aria-live="polite"
            className={`pointer-events-auto max-w-[min(600px,92vw)] rounded-2xl px-4 py-2 text-center text-sm leading-relaxed sm:text-[15px] ${
              subtitleDir === 'rtl' ? 'font-bilingual-rtl' : 'font-bilingual-ltr'
            } ${
              subtitleTone === 'error'
                ? 'bg-[#2a0c16]/85 text-rose-100 ring-1 ring-rose-400/35'
                : subtitleTone === 'interim'
                  ? 'bg-[#030a14]/75 text-cyan-100/85'
                  : 'bg-[#030a14]/82 text-[#eefbff] shadow-[0_6px_28px_rgba(0,0,0,0.65)]'
            }`}
          >
            {subtitleText}
          </div>
        )}

        {/* Ultra-Minimalist Liquid Glass Capsule: ONLY Mic + Text Chat Input + Send */}
        <form
          onSubmit={handleSubmit}
          aria-label="Voice and text chat"
          className={`${
            isUiRevealed ? 'pointer-events-auto' : 'pointer-events-none'
          } ${glassClass} flex h-14 w-full max-w-[min(560px,94vw)] items-center gap-1.5 rounded-full px-2 sm:h-[58px] sm:gap-2 sm:px-2.5`}
        >
          {/* 1. Live Voice / Microphone Button (with instant Barge-In) */}
          <button
            type="button"
            onClick={toggleMicrophone}
            tabIndex={isUiRevealed ? 0 : -1}
            aria-label={
              phase === 'listening' || phase === 'barge_in'
                ? 'Stop voice input'
                : phase === 'speaking'
                  ? 'Interrupt and speak'
                  : 'Start voice input'
            }
            aria-pressed={phase === 'listening' || phase === 'barge_in'}
            className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
              phase === 'listening' || phase === 'barge_in'
                ? 'bg-cyan-300/25 text-white ring-1 ring-cyan-200/75'
                : phase === 'speaking'
                  ? 'bg-rose-400/18 text-rose-100 ring-1 ring-rose-300/45 hover:bg-rose-400/30'
                  : 'text-cyan-100/85 hover:bg-cyan-300/14 hover:text-white'
            }`}
          >
            {phase === 'listening' || phase === 'barge_in' ? (
              <MicOff className="h-[19px] w-[19px]" aria-hidden="true" />
            ) : (
              <Mic className="h-[19px] w-[19px]" aria-hidden="true" />
            )}
          </button>

          {/* 2. English Text Chat Input */}
          <label htmlFor="hologram-chat-input" className="sr-only">
            Message
          </label>
          <input
            id="hologram-chat-input"
            type="text"
            value={inputText}
            dir={inputDir}
            tabIndex={isUiRevealed ? 0 : -1}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Speak or type a message..."
            autoComplete="off"
            className={`min-w-0 flex-1 bg-transparent px-2 text-sm text-cyan-50 placeholder:text-cyan-200/45 focus:outline-none sm:text-[15px] ${
              inputDir === 'rtl' ? 'font-bilingual-rtl text-right' : 'font-bilingual-ltr text-left'
            }`}
          />

          {/* 3. Send Button */}
          <button
            type="submit"
            disabled={!inputText.trim() || phase === 'thinking'}
            tabIndex={isUiRevealed ? 0 : -1}
            aria-label="Send message"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-cyan-300/20 text-cyan-50 ring-1 ring-cyan-200/35 transition-all duration-150 hover:bg-cyan-300/30 hover:text-white active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-300/8 disabled:text-cyan-200/35 disabled:ring-cyan-200/12"
          >
            <SendHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
}
