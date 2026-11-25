import { useEffect, useRef, useState } from 'react';
import {
  Cpu,
  Mic,
  MicOff,
  Sliders,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import {
  SUPPORTED_LANGUAGES,
  VOICE_PRESETS,
  type LlmEngineId,
  type OrchestratorTransport,
  type PersonaAgeGroup,
  type PersonaGender,
  type PersonaLanguage,
  type PersonaTone,
  type SttEngineId,
  type TtsEngineId,
  type VoicePersonaState,
} from '../types/voicePersona';

interface VoicePersonaPanelProps {
  persona: VoicePersonaState;
  onChange: (next: VoicePersonaState) => void;
  isOpen: boolean;
  onClose: () => void;
  isSoftwareGl: boolean;
  onUploadAudioClip?: (file: File) => void;
}

const GENDER_OPTIONS: Array<{ id: PersonaGender; label: string }> = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'neutral', label: 'Neutral' },
];

const AGE_OPTIONS: Array<{ id: PersonaAgeGroup; label: string }> = [
  { id: 'child_young', label: 'Young' },
  { id: 'young_adult', label: 'Young Adult' },
  { id: 'middle_aged', label: 'Middle-Aged' },
  { id: 'senior_wise', label: 'Senior / Wise' },
];

const TONE_OPTIONS: Array<{ id: PersonaTone; label: string }> = [
  { id: 'tactical_serious', label: 'Tactical / Serious' },
  { id: 'calm_empathetic', label: 'Calm & Empathetic' },
  { id: 'energetic_enthusiastic', label: 'Energetic' },
  { id: 'storytelling_dramatic', label: 'Storytelling' },
  { id: 'casual_friendly', label: 'Casual & Friendly' },
  { id: 'formal_executive', label: 'Formal / Executive' },
];

export function VoicePersonaPanel({
  persona,
  onChange,
  isOpen,
  onClose,
  isSoftwareGl,
  onUploadAudioClip,
}: VoicePersonaPanelProps) {
  const [activeTab, setActiveTab] = useState<'voice' | 'stack'>('voice');
  const [isRecordingRef, setIsRecordingRef] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const refAudioInputRef = useRef<HTMLInputElement | null>(null);
  const transcribeInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current !== null) clearTimeout(recordTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore recorder stop error on unmount
        }
      }
    };
  }, []);

  if (!isOpen) return null;

  const glassClass = isSoftwareGl ? 'liquid-glass' : 'liquid-glass gpu-glass';

  const applyPreset = (presetId: string) => {
    const preset = VOICE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    onChange({
      ...persona,
      presetId: preset.id,
      gender: preset.defaultGender,
      age: preset.defaultAge,
      tone: preset.defaultTone,
      pitch: preset.pitch,
      speed: preset.speed,
      expressiveness: preset.expressiveness,
    });
  };

  const handleRefFileUpload = (file: File) => {
    setRecordError(null);
    if (persona.referenceAudio?.objectUrl) {
      URL.revokeObjectURL(persona.referenceAudio.objectUrl);
    }
    const objectUrl = URL.createObjectURL(file);
    onChange({
      ...persona,
      referenceAudio: {
        fileName: file.name,
        mimeType: file.type || 'audio/wav',
        durationSec: 7.0,
        objectUrl,
        source: 'upload',
      },
    });
  };

  const clearRefAudio = () => {
    if (persona.referenceAudio?.objectUrl) {
      URL.revokeObjectURL(persona.referenceAudio.objectUrl);
    }
    onChange({ ...persona, referenceAudio: null });
  };

  const toggleRecordReference = async () => {
    setRecordError(null);
    if (isRecordingRef && mediaRecorderRef.current) {
      if (recordTimerRef.current !== null) clearTimeout(recordTimerRef.current);
      mediaRecorderRef.current.stop();
      setIsRecordingRef(false);
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setRecordError('Voice recording is unavailable here. Upload a 5–10s audio clip instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      recordStartRef.current = performance.now();

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        const durationSec = Math.max(
          1,
          Math.round(((performance.now() - recordStartRef.current) / 1000) * 10) / 10,
        );
        if (persona.referenceAudio?.objectUrl) {
          URL.revokeObjectURL(persona.referenceAudio.objectUrl);
        }
        const objectUrl = URL.createObjectURL(blob);
        onChange({
          ...persona,
          referenceAudio: {
            fileName: `voice-sample-${durationSec}s.webm`,
            mimeType: blob.type || 'audio/webm',
            durationSec,
            objectUrl,
            source: 'recording',
          },
        });
        setIsRecordingRef(false);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingRef(true);

      // Automatically stop at 10 seconds for zero-shot reference cloning clip
      recordTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, 10000);
    } catch {
      setRecordError('Microphone access was denied.');
      setIsRecordingRef(false);
    }
  };

  return (
    <aside
      aria-label="Voice and Persona Controls"
      className={`fixed top-14 right-3 z-30 flex max-h-[calc(100dvh-146px)] w-[min(324px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl sm:top-16 sm:right-5 ${glassClass}`}
    >
      {/* Header & Tabs */}
      <div className="flex items-center justify-between border-b border-cyan-200/14 px-3.5 py-2.5">
        <div className="flex items-center gap-1" role="tablist" aria-label="Control sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'voice'}
            onClick={() => setActiveTab('voice')}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === 'voice'
                ? 'bg-cyan-300/20 text-white'
                : 'text-cyan-200/65 hover:text-cyan-50'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Voice & Persona</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'stack'}
            onClick={() => setActiveTab('stack')}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === 'stack'
                ? 'bg-cyan-300/20 text-white'
                : 'text-cyan-200/65 hover:text-cyan-50'
            }`}
          >
            <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Stack</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close voice and persona panel"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-cyan-200/65 transition-colors hover:bg-cyan-300/15 hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 space-y-4 overflow-y-auto px-3.5 py-3 text-xs text-cyan-100/90">
        {activeTab === 'voice' ? (
          <>
            {/* 1. Language Selector */}
            <div className="space-y-1.5">
              <label htmlFor="persona-language-select" className="block text-[11px] font-medium text-cyan-200/70">
                Language
              </label>
              <select
                id="persona-language-select"
                value={persona.language}
                onChange={(e) =>
                  onChange({ ...persona, language: e.target.value as PersonaLanguage })
                }
                className="w-full rounded-lg border border-cyan-200/20 bg-[#051427]/90 px-2.5 py-1.5 text-xs text-cyan-50 focus:border-cyan-300/60 focus:outline-none"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.id} value={lang.id} className="bg-[#051427] text-cyan-50">
                    {lang.label} — {lang.nativeLabel}
                  </option>
                ))}
              </select>

              {(persona.language === 'fa' || persona.language === 'auto') && (
                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => onChange({ ...persona, persianRegister: 'natural_spoken' })}
                    aria-pressed={persona.persianRegister === 'natural_spoken'}
                    className={`flex-1 cursor-pointer rounded-md px-2 py-1 text-[11px] transition-colors ${
                      persona.persianRegister === 'natural_spoken'
                        ? 'bg-cyan-300/22 text-white ring-1 ring-cyan-200/40'
                        : 'bg-[#06182c]/70 text-cyan-200/65 hover:text-cyan-50'
                    }`}
                  >
                    محاوره‌ای (Spoken)
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange({ ...persona, persianRegister: 'formal_literary' })}
                    aria-pressed={persona.persianRegister === 'formal_literary'}
                    className={`flex-1 cursor-pointer rounded-md px-2 py-1 text-[11px] transition-colors ${
                      persona.persianRegister === 'formal_literary'
                        ? 'bg-cyan-300/22 text-white ring-1 ring-cyan-200/40'
                        : 'bg-[#06182c]/70 text-cyan-200/65 hover:text-cyan-50'
                    }`}
                  >
                    رسمی (Formal)
                  </button>
                </div>
              )}
            </div>

            {/* 2. Gender */}
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium text-cyan-200/70">Gender</span>
              <div className="grid grid-cols-3 gap-1.5">
                {GENDER_OPTIONS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => onChange({ ...persona, gender: g.id })}
                    aria-pressed={persona.gender === g.id}
                    className={`cursor-pointer rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      persona.gender === g.id
                        ? 'bg-cyan-300/22 text-white ring-1 ring-cyan-200/45'
                        : 'bg-[#06182c]/70 text-cyan-200/70 hover:bg-cyan-300/10 hover:text-white'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Age Group */}
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium text-cyan-200/70">Age Group</span>
              <div className="grid grid-cols-2 gap-1.5">
                {AGE_OPTIONS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onChange({ ...persona, age: a.id })}
                    aria-pressed={persona.age === a.id}
                    className={`cursor-pointer rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      persona.age === a.id
                        ? 'bg-cyan-300/22 text-white ring-1 ring-cyan-200/45'
                        : 'bg-[#06182c]/70 text-cyan-200/70 hover:bg-cyan-300/10 hover:text-white'
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Tone & Emotion */}
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium text-cyan-200/70">Tone & Emotion</span>
              <div className="grid grid-cols-2 gap-1.5">
                {TONE_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChange({ ...persona, tone: t.id })}
                    aria-pressed={persona.tone === t.id}
                    className={`cursor-pointer rounded-lg px-2 py-1.5 text-left text-[11px] font-medium transition-colors ${
                      persona.tone === t.id
                        ? 'bg-cyan-300/22 text-white ring-1 ring-cyan-200/45'
                        : 'bg-[#06182c]/70 text-cyan-200/70 hover:bg-cyan-300/10 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 5. Voice Presets */}
            <div className="space-y-1.5">
              <label htmlFor="voice-preset-select" className="block text-[11px] font-medium text-cyan-200/70">
                Voice Preset
              </label>
              <select
                id="voice-preset-select"
                value={persona.presetId}
                onChange={(e) => applyPreset(e.target.value)}
                className="w-full rounded-lg border border-cyan-200/20 bg-[#051427]/90 px-2.5 py-1.5 text-xs text-cyan-50 focus:border-cyan-300/60 focus:outline-none"
              >
                {VOICE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id} className="bg-[#051427] text-cyan-50">
                    {preset.name} — {preset.summary}
                  </option>
                ))}
              </select>
            </div>

            {/* 6. Reference Voice Cloning Slot (5-10s upload or record) */}
            <div className="space-y-1.5 border-t border-cyan-200/12 pt-3">
              <span className="block text-[11px] font-medium text-cyan-200/70">
                Reference Voice Sample (5–10s Zero-Shot)
              </span>
              <input
                ref={refAudioInputRef}
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleRefFileUpload(file);
                  e.target.value = '';
                }}
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => refAudioInputRef.current?.click()}
                  className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[#06182c]/80 px-2.5 py-1.5 text-[11px] font-medium text-cyan-100 ring-1 ring-cyan-200/20 hover:bg-cyan-300/15"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Upload Clip</span>
                </button>
                <button
                  type="button"
                  onClick={() => void toggleRecordReference()}
                  className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ring-1 transition-colors ${
                    isRecordingRef
                      ? 'bg-rose-400/25 text-rose-100 ring-rose-300/50'
                      : 'bg-[#06182c]/80 text-cyan-100 ring-cyan-200/20 hover:bg-cyan-300/15'
                  }`}
                >
                  {isRecordingRef ? (
                    <>
                      <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Stop Rec</span>
                    </>
                  ) : (
                    <>
                      <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Record 5–10s</span>
                    </>
                  )}
                </button>
              </div>

              {recordError && <p className="text-[11px] text-rose-300">{recordError}</p>}

              {persona.referenceAudio && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-cyan-400/10 px-2.5 py-1.5 text-[11px] ring-1 ring-cyan-200/25">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 shrink-0 text-cyan-200" aria-hidden="true" />
                    <span className="truncate text-cyan-50">{persona.referenceAudio.fileName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={clearRefAudio}
                    aria-label="Remove reference voice sample"
                    className="cursor-pointer text-cyan-200/70 hover:text-rose-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}

              {onUploadAudioClip && (
                <div className="pt-1">
                  <input
                    ref={transcribeInputRef}
                    type="file"
                    accept="audio/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onUploadAudioClip(file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => transcribeInputRef.current?.click()}
                    className="w-full cursor-pointer rounded-lg border border-dashed border-cyan-200/22 py-1.5 text-[11px] text-cyan-200/75 transition-colors hover:border-cyan-200/45 hover:text-white"
                  >
                    Transcribe Audio File to Chat
                  </button>
                </div>
              )}
            </div>

            {/* 7. Pitch, Speed & Expressiveness Sliders */}
            <div className="space-y-2.5 border-t border-cyan-200/12 pt-3">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <label htmlFor="slider-pitch" className="text-cyan-200/75">
                    Pitch
                  </label>
                  <span className="tabular-nums text-cyan-50">{persona.pitch.toFixed(2)}x</span>
                </div>
                <input
                  id="slider-pitch"
                  type="range"
                  min={0.75}
                  max={1.3}
                  step={0.02}
                  value={persona.pitch}
                  onChange={(e) => onChange({ ...persona, pitch: Number(e.target.value) })}
                  className="h-1.5 w-full cursor-pointer accent-cyan-300"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <label htmlFor="slider-speed" className="text-cyan-200/75">
                    Speed
                  </label>
                  <span className="tabular-nums text-cyan-50">{persona.speed.toFixed(2)}x</span>
                </div>
                <input
                  id="slider-speed"
                  type="range"
                  min={0.75}
                  max={1.35}
                  step={0.02}
                  value={persona.speed}
                  onChange={(e) => onChange({ ...persona, speed: Number(e.target.value) })}
                  className="h-1.5 w-full cursor-pointer accent-cyan-300"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <label htmlFor="slider-expressiveness" className="text-cyan-200/75">
                    Expressiveness
                  </label>
                  <span className="tabular-nums text-cyan-50">
                    {Math.round(persona.expressiveness * 100)}%
                  </span>
                </div>
                <input
                  id="slider-expressiveness"
                  type="range"
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  value={persona.expressiveness}
                  onChange={(e) => onChange({ ...persona, expressiveness: Number(e.target.value) })}
                  className="h-1.5 w-full cursor-pointer accent-cyan-300"
                />
              </div>
            </div>
          </>
        ) : (
          /* Open-Source Real-Time Stack Configuration Tab */
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="stack-transport" className="block text-[11px] font-medium text-cyan-200/70">
                Real-Time Orchestrator
              </label>
              <select
                id="stack-transport"
                value={persona.pipeline.transport}
                onChange={(e) =>
                  onChange({
                    ...persona,
                    pipeline: {
                      ...persona.pipeline,
                      transport: e.target.value as OrchestratorTransport,
                    },
                  })
                }
                className="w-full rounded-lg border border-cyan-200/20 bg-[#051427]/90 px-2.5 py-1.5 text-xs text-cyan-50"
              >
                <option value="builtin-gemini">Built-In Low-Latency Pipeline</option>
                <option value="pipecat-ws">Pipecat WebSocket (pipecat-ai/pipecat)</option>
                <option value="livekit-rtc">LiveKit Agents WebRTC (livekit/agents)</option>
              </select>
            </div>

            {persona.pipeline.transport !== 'builtin-gemini' && (
              <div className="space-y-1">
                <label htmlFor="stack-endpoint" className="block text-[11px] text-cyan-200/70">
                  Orchestrator Endpoint URL
                </label>
                <input
                  id="stack-endpoint"
                  type="text"
                  value={persona.pipeline.endpointUrl}
                  onChange={(e) =>
                    onChange({
                      ...persona,
                      pipeline: { ...persona.pipeline, endpointUrl: e.target.value },
                    })
                  }
                  className="w-full rounded-lg border border-cyan-200/20 bg-[#051427]/90 px-2.5 py-1.5 text-xs text-cyan-50"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="stack-stt" className="block text-[11px] font-medium text-cyan-200/70">
                Multilingual STT Engine
              </label>
              <select
                id="stack-stt"
                value={persona.pipeline.sttEngine}
                onChange={(e) =>
                  onChange({
                    ...persona,
                    pipeline: { ...persona.pipeline, sttEngine: e.target.value as SttEngineId },
                  })
                }
                className="w-full rounded-lg border border-cyan-200/20 bg-[#051427]/90 px-2.5 py-1.5 text-xs text-cyan-50"
              >
                <option value="faster-whisper-large-v3-turbo">faster-whisper (large-v3-turbo)</option>
                <option value="gemini-3.5-transcribe">Built-In Neural Transcribe</option>
                <option value="browser-webspeech">Browser Web Speech API</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="stack-llm" className="block text-[11px] font-medium text-cyan-200/70">
                Multilingual LLM Adapter
              </label>
              <select
                id="stack-llm"
                value={persona.pipeline.llmEngine}
                onChange={(e) =>
                  onChange({
                    ...persona,
                    pipeline: { ...persona.pipeline, llmEngine: e.target.value as LlmEngineId },
                  })
                }
                className="w-full rounded-lg border border-cyan-200/20 bg-[#051427]/90 px-2.5 py-1.5 text-xs text-cyan-50"
              >
                <option value="gemini-4-hydrogen">Built-In Low-Latency LLM</option>
                <option value="qwen-2.5-72b">Qwen 2.5 (Persian + Multilingual)</option>
                <option value="gemma-3-27b">Gemma 3 27B</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="stack-tts" className="block text-[11px] font-medium text-cyan-200/70">
                Voice Synthesis / TTS Router
              </label>
              <select
                id="stack-tts"
                value={persona.pipeline.ttsEngine}
                onChange={(e) =>
                  onChange({
                    ...persona,
                    pipeline: { ...persona.pipeline, ttsEngine: e.target.value as TtsEngineId },
                  })
                }
                className="w-full rounded-lg border border-cyan-200/20 bg-[#051427]/90 px-2.5 py-1.5 text-xs text-cyan-50"
              >
                <option value="auto">Auto-Route (F5-TTS-Persian / CosyVoice 2)</option>
                <option value="cosyvoice2">CosyVoice 2 (Multilingual + Emotion)</option>
                <option value="f5-tts-persian">F5-TTS-Persian (Natural Farsi)</option>
                <option value="xtts-v2-parsvoice">XTTS-v2 / ParsVoice (Zero-Shot Cloning)</option>
                <option value="piper-onnx">Piper ONNX (Edge Low-Latency)</option>
                <option value="browser-speech">Browser SpeechSynthesis Only</option>
              </select>
            </div>

            <div className="space-y-2 border-t border-cyan-200/12 pt-3">
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-[11px] text-cyan-100">Silero-Style VAD Mic Monitor</span>
                <input
                  type="checkbox"
                  checked={persona.pipeline.vadEnabled}
                  onChange={(e) =>
                    onChange({
                      ...persona,
                      pipeline: { ...persona.pipeline, vadEnabled: e.target.checked },
                    })
                  }
                  className="accent-cyan-300"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-[11px] text-cyan-100">Instant Barge-In / Interrupt</span>
                <input
                  type="checkbox"
                  checked={persona.pipeline.bargeInEnabled}
                  onChange={(e) =>
                    onChange({
                      ...persona,
                      pipeline: { ...persona.pipeline, bargeInEnabled: e.target.checked },
                    })
                  }
                  className="accent-cyan-300"
                />
              </label>

              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-[11px]">
                  <label htmlFor="slider-vad" className="text-cyan-200/75">
                    VAD Sensitivity Threshold
                  </label>
                  <span className="tabular-nums text-cyan-50">
                    {persona.pipeline.vadThreshold.toFixed(2)}
                  </span>
                </div>
                <input
                  id="slider-vad"
                  type="range"
                  min={0.06}
                  max={0.35}
                  step={0.01}
                  value={persona.pipeline.vadThreshold}
                  onChange={(e) =>
                    onChange({
                      ...persona,
                      pipeline: { ...persona.pipeline, vadThreshold: Number(e.target.value) },
                    })
                  }
                  className="h-1.5 w-full cursor-pointer accent-cyan-300"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
