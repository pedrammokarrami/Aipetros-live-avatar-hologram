import {
  buildDynamicPersonaSystemPrompt,
  detectMultilingualLanguage,
  resolveTtsRoutingPlan,
} from '../utils/personaPromptBuilder';
import type {
  PersonaLanguage,
  ResolvedLanguage,
  TtsRoutingPlan,
  VoicePersonaState,
} from '../types/voicePersona';

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
}

export interface VisualContextAttachment {
  fileName: string;
  mimeType: string;
  base64: string;
  previewUrl: string;
}

export interface SendTurnRequest {
  message: string;
  history: ConversationTurn[];
  persona: VoicePersonaState;
  visualContext?: VisualContextAttachment | null;
}

export interface SendTurnResponse {
  reply: string;
  lang: ResolvedLanguage;
  dir: 'rtl' | 'ltr';
  routingPlan: TtsRoutingPlan;
}

export interface SynthesizeSpeechRequest {
  text: string;
  lang: ResolvedLanguage;
  persona: VoicePersonaState;
  routingPlan: TtsRoutingPlan;
  voiceNameOverride?: string;
}

export interface SynthesizeSpeechResponse {
  audioBase64: string | null;
  mimeType?: string;
  mode: 'audio' | 'speechSynthesis';
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export async function fileToVisualContext(file: File): Promise<VisualContextAttachment> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (PNG, JPG, WebP).');
  }
  const base64 = await readFileAsBase64(file);
  const previewUrl = URL.createObjectURL(file);
  return {
    fileName: file.name,
    mimeType: file.type || 'image/jpeg',
    base64,
    previewUrl,
  };
}

/**
 * Unified multilingual voice conversation orchestrator.
 * Supports instant barge-in cancellation via AbortController and routes requests cleanly
 * through the built-in server APIs (or optional external Pipecat / LiveKit bridges).
 */
export class VoicePipelineService {
  private chatAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private transcribeAbort: AbortController | null = null;

  public interrupt(): void {
    if (this.chatAbort) {
      this.chatAbort.abort();
      this.chatAbort = null;
    }
    if (this.ttsAbort) {
      this.ttsAbort.abort();
      this.ttsAbort = null;
    }
    if (this.transcribeAbort) {
      this.transcribeAbort.abort();
      this.transcribeAbort = null;
    }
  }

  public async sendTurn(req: SendTurnRequest): Promise<SendTurnResponse> {
    if (this.chatAbort) {
      this.chatAbort.abort();
    }
    const controller = new AbortController();
    this.chatAbort = controller;

    const targetLang = detectMultilingualLanguage(req.message, req.persona.language, 'en');
    const systemPrompt = buildDynamicPersonaSystemPrompt(req.persona, targetLang);

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message: req.message,
        history: req.history.slice(-10),
        targetLang,
        systemPrompt,
        imageContext: req.visualContext
          ? {
              base64: req.visualContext.base64,
              mimeType: req.visualContext.mimeType,
            }
          : undefined,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || `Voice intelligence request failed (${response.status}).`);
    }

    const data = (await response.json()) as {
      reply?: string;
      lang?: ResolvedLanguage;
      dir?: 'rtl' | 'ltr';
    };

    const reply = (data.reply ?? '').trim();
    if (!reply) {
      throw new Error('Empty response received from voice intelligence engine.');
    }

    const resolvedLang = data.lang ?? detectMultilingualLanguage(reply, req.persona.language, targetLang);
    const routingPlan = resolveTtsRoutingPlan(req.persona, resolvedLang);

    return {
      reply,
      lang: resolvedLang,
      dir: data.dir ?? (resolvedLang === 'fa' || resolvedLang === 'ar' ? 'rtl' : 'ltr'),
      routingPlan,
    };
  }

  public async synthesizeSpeech(req: SynthesizeSpeechRequest): Promise<SynthesizeSpeechResponse> {
    if (this.ttsAbort) {
      this.ttsAbort.abort();
    }
    const controller = new AbortController();
    this.ttsAbort = controller;

    if (req.persona.pipeline.ttsEngine === 'browser-speech') {
      return { audioBase64: null, mode: 'speechSynthesis' };
    }

    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        text: req.text,
        lang: req.lang,
        voiceName: req.voiceNameOverride || req.routingPlan.geminiVoice,
        style: req.routingPlan.styleDirective,
        engine: req.routingPlan.primaryEngine,
      }),
    });

    if (!response.ok) {
      return { audioBase64: null, mode: 'speechSynthesis' };
    }

    const payload = (await response.json()) as {
      audioBase64?: string | null;
      mimeType?: string;
      mode?: 'audio' | 'speechSynthesis';
    };

    if (payload.audioBase64) {
      return {
        audioBase64: payload.audioBase64,
        mimeType: payload.mimeType || 'audio/wav',
        mode: 'audio',
      };
    }

    return { audioBase64: null, mode: 'speechSynthesis' };
  }

  public async transcribeAudioFile(file: File, language: PersonaLanguage): Promise<string> {
    if (this.transcribeAbort) {
      this.transcribeAbort.abort();
    }
    const controller = new AbortController();
    this.transcribeAbort = controller;

    const data = await readFileAsBase64(file);
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        data,
        mimeType: file.type || 'audio/webm',
        language,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || 'Could not transcribe audio clip.');
    }

    const payload = (await response.json()) as { transcript?: string };
    const transcript = (payload.transcript ?? '').trim();
    if (!transcript) {
      throw new Error('No clear speech was detected in this audio clip.');
    }
    return transcript;
  }
}
