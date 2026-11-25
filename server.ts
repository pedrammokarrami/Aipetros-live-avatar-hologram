import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  normalizeRuntimeConfig,
  type HologramRuntimeConfig,
} from './src/utils/hologramConfig';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_GEMINI_VOICES = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);

interface ChatHistoryItem {
  role: 'user' | 'model';
  text: string;
}

function createGeminiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      ...(apiVersion ? { apiVersion } : {}),
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isRtlScript(text: string): 'fa' | 'ar' | null {
  const arabicScript = text.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g);
  if (!arabicScript || arabicScript.length === 0) return null;
  const persianSpecific = text.match(/[پچژگکی]/g);
  if (persianSpecific && persianSpecific.length > 0) return 'fa';
  if (/(مرحبا|أهلا|كيف|شكرا|العربية)/u.test(text)) return 'ar';
  return 'fa';
}

function buildInitialRuntimeConfig(): HologramRuntimeConfig {
  return normalizeRuntimeConfig({
    glbUrl: process.env.HOLOGRAM_GLB_URL || null,
    backgroundUrl:
      process.env.HOLOGRAM_BG_URL || '/src/assets/images/cs2_world_backdrop_1795601005197.jpg',
    voice: {
      language: process.env.VOICE_LANGUAGE || 'auto',
      persianRegister: process.env.VOICE_PERSIAN_REGISTER || 'natural_spoken',
      gender: process.env.VOICE_GENDER || 'male',
      age: process.env.VOICE_AGE || 'middle_aged',
      tone: process.env.VOICE_TONE || 'tactical_serious',
      presetId: process.env.VOICE_PRESET || 'vanguard-ops',
      voiceName: process.env.VOICE_GEMINI_NAME || 'Fenrir',
      pitch: process.env.VOICE_PITCH ? Number(process.env.VOICE_PITCH) : 0.96,
      speed: process.env.VOICE_SPEED ? Number(process.env.VOICE_SPEED) : 1.0,
      expressiveness: process.env.VOICE_EXPRESSIVENESS
        ? Number(process.env.VOICE_EXPRESSIVENESS)
        : 0.62,
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  let runtimeConfig: HologramRuntimeConfig = buildInitialRuntimeConfig();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  /**
   * Returns the authoritative voice persona & .GLB hologram configuration for the client.
   * When an external https GLB URL is configured, exposes /api/glb to avoid CORS issues.
   */
  app.get('/api/config', (_req, res) => {
    const clientGlbUrl =
      runtimeConfig.glbUrl && /^https?:\/\//i.test(runtimeConfig.glbUrl)
        ? '/api/glb'
        : runtimeConfig.glbUrl;

    res.json({
      ...runtimeConfig,
      glbUrl: clientGlbUrl,
    });
  });

  /**
   * Allows external backend orchestration or admin tools to update the active voice model
   * and .GLB hologram URL dynamically without touching the UI.
   */
  app.post('/api/config', (req, res) => {
    const incoming = req.body && typeof req.body === 'object' ? req.body : {};
    runtimeConfig = normalizeRuntimeConfig({
      glbUrl: 'glbUrl' in incoming ? incoming.glbUrl : runtimeConfig.glbUrl,
      backgroundUrl:
        'backgroundUrl' in incoming ? incoming.backgroundUrl : runtimeConfig.backgroundUrl,
      voice: {
        ...runtimeConfig.voice,
        ...(incoming.voice && typeof incoming.voice === 'object' ? incoming.voice : {}),
      },
    });
    res.json({ ok: true, config: runtimeConfig });
  });

  /**
   * Server-side proxy for remote HTTPS .glb/.gltf models configured via HOLOGRAM_GLB_URL or POST /api/config.
   */
  app.get('/api/glb', async (_req, res) => {
    if (!runtimeConfig.glbUrl || !/^https?:\/\//i.test(runtimeConfig.glbUrl)) {
      return res.status(404).json({ error: 'No remote GLB model URL is configured.' });
    }
    try {
      const upstream = await fetch(runtimeConfig.glbUrl);
      if (!upstream.ok) {
        return res.status(502).json({ error: `Upstream GLB fetch failed (${upstream.status}).` });
      }
      const arrayBuf = await upstream.arrayBuffer();
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'model/gltf-binary');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.send(Buffer.from(arrayBuf));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch configured GLB model.';
      return res.status(502).json({ error: msg });
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!rawMessage) {
        return res.status(400).json({ error: 'Message cannot be empty.' });
      }
      if (rawMessage.length > 2400) {
        return res.status(400).json({ error: 'Message is too long.' });
      }

      const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
      const history: ChatHistoryItem[] = rawHistory
        .slice(-10)
        .filter(
          (item: unknown): item is ChatHistoryItem =>
            typeof item === 'object' &&
            item !== null &&
            ((item as ChatHistoryItem).role === 'user' || (item as ChatHistoryItem).role === 'model') &&
            typeof (item as ChatHistoryItem).text === 'string' &&
            (item as ChatHistoryItem).text.trim().length > 0,
        );

      const customSystemPrompt =
        typeof req.body?.systemPrompt === 'string' && req.body.systemPrompt.trim().length > 20
          ? req.body.systemPrompt.trim().slice(0, 1800)
          : null;

      const requestedLang = typeof req.body?.targetLang === 'string' ? req.body.targetLang : 'en';
      const fallbackRtl = isRtlScript(rawMessage);
      const preferredLang = requestedLang || fallbackRtl || 'en';

      const imageContext =
        req.body?.imageContext &&
        typeof req.body.imageContext.base64 === 'string' &&
        typeof req.body.imageContext.mimeType === 'string' &&
        req.body.imageContext.mimeType.startsWith('image/')
          ? {
              base64: req.body.imageContext.base64,
              mimeType: req.body.imageContext.mimeType,
            }
          : null;

      const ai = createGeminiClient();
      const userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (imageContext) {
        userParts.push({
          inlineData: {
            mimeType: imageContext.mimeType,
            data: imageContext.base64,
          },
        });
      }
      userParts.push({ text: rawMessage });

      const contents = [
        ...history.map((turn) => ({
          role: turn.role,
          parts: [{ text: turn.text }],
        })),
        {
          role: 'user' as const,
          parts: userParts,
        },
      ];

      const systemInstruction =
        customSystemPrompt ??
        [
          'You are Aether, a calm, articulate, warm 3D holographic voice companion.',
          'Keep every reply natural for spoken voice delivery: concise (1 to 3 short sentences, under 45 words), plain prose with no markdown, bullet lists, asterisks, or emojis.',
          preferredLang === 'fa'
            ? 'Respond naturally and warmly in fluent modern Persian (RTL).'
            : 'Respond naturally and fluently in the user language.',
        ].join(' ');

      const candidateModels = [
        { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW },
        { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL },
      ];

      let responseText = '';
      let lastError: unknown = null;

      for (const candidate of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model: candidate.model,
            contents,
            config: {
              systemInstruction,
              thinkingConfig: {
                thinkingLevel: candidate.thinkingLevel,
              },
            },
          });
          responseText = (response.text ?? '').replace(/[*_`#]/g, '').trim();
          if (responseText) break;
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient = /503|UNAVAILABLE|high demand|overloaded|429|RESOURCE_EXHAUSTED/i.test(msg);
          if (!isTransient) throw err;
          await new Promise((r) => setTimeout(r, 350));
        }
      }

      if (!responseText) {
        if (lastError) throw lastError;
        return res.status(502).json({ error: 'Empty response received from language model.' });
      }

      const detectedRtl = isRtlScript(responseText);
      const replyLang = detectedRtl ?? preferredLang;
      return res.json({
        reply: responseText,
        lang: replyLang,
        dir: replyLang === 'fa' || replyLang === 'ar' ? 'rtl' : 'ltr',
      });
    } catch (err) {
      let message = err instanceof Error ? err.message : 'Failed to generate reply.';
      try {
        const parsed = JSON.parse(message) as { error?: { message?: string } };
        if (parsed?.error?.message) {
          message = parsed.error.message;
        }
      } catch {
        // Keep plain string message
      }
      console.error('[/api/chat] error:', message);
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/transcribe', async (req, res) => {
    try {
      const data = typeof req.body?.data === 'string' ? req.body.data.trim() : '';
      const mimeType =
        typeof req.body?.mimeType === 'string' && req.body.mimeType.startsWith('audio/')
          ? req.body.mimeType
          : 'audio/webm';
      const language = typeof req.body?.language === 'string' ? req.body.language : 'auto';

      if (!data) {
        return res.status(400).json({ error: 'Audio payload is required.' });
      }

      const ai = createGeminiClient();
      const prompt =
        language === 'auto'
          ? 'Transcribe this spoken audio accurately in its original language (including Persian, English, Arabic, or mixed terms). Return only the plain transcript text.'
          : `Transcribe this spoken audio accurately in language code "${language}". Return only the plain transcript text.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            { inlineData: { mimeType, data } },
            { text: prompt },
          ],
        },
      });

      const transcript = (response.text ?? '').trim();
      if (!transcript) {
        return res.status(422).json({ error: 'Could not detect clear speech in this audio clip.' });
      }
      return res.json({ transcript });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Audio transcription failed.';
      console.error('[/api/transcribe] error:', message);
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/tts', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const lang = typeof req.body?.lang === 'string' ? req.body.lang : 'en';
    const rawVoice = typeof req.body?.voiceName === 'string' ? req.body.voiceName : 'Fenrir';
    const voiceName = ALLOWED_GEMINI_VOICES.has(rawVoice) ? rawVoice : 'Fenrir';
    const rawStyle =
      typeof req.body?.style === 'string' && req.body.style.trim().length > 0
        ? req.body.style.trim().slice(0, 240)
        : lang === 'fa'
          ? 'Warm, natural, clear Persian voice with calm conversational pacing'
          : 'Clear, articulate natural conversational voice';

    if (!text) {
      return res.status(400).json({ error: 'Text is required for speech synthesis.' });
    }

    const attempts: Array<{ apiVersion: string; includeMetadata: boolean }> = [
      { apiVersion: 'v1beta', includeMetadata: true },
      { apiVersion: 'v1beta', includeMetadata: false },
      { apiVersion: 'v1alpha', includeMetadata: false },
    ];

    for (const attempt of attempts) {
      try {
        const ai = createGeminiClient(attempt.apiVersion);
        const part = attempt.includeMetadata
          ? { text, speechMetadata: { style: rawStyle } }
          : { text };

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [{ role: 'user', parts: [part] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        });

        const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const base64Audio = inlineData?.data;
        if (base64Audio) {
          return res.json({
            audioBase64: base64Audio,
            mimeType: inlineData?.mimeType || 'audio/wav',
            mode: 'audio',
          });
        }
      } catch {
        // Try next API version / payload variant
      }
    }

    return res.json({ audioBase64: null, mode: 'speechSynthesis' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
