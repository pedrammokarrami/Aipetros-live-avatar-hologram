# Open-Source Multilingual Voice Stack Guide

Aether runs out of the box with the built-in server pipeline (`/api/chat`, `/api/transcribe`, `/api/tts`) and includes modular configuration hooks for self-hosted open-source voice components:

## Recommended Self-Hosted Components
- **Real-Time Orchestrator**: [Pipecat](https://github.com/pipecat-ai/pipecat) or [LiveKit Agents](https://github.com/livekit/agents) with Silero VAD for low-latency turn-taking and barge-in.
- **Multilingual STT**: `faster-whisper` (`large-v3-turbo`) for Persian, Arabic, English, and 90+ languages.
- **Multilingual LLM**: `Qwen 2.5 72B/32B` or `Gemma 3 27B` served via vLLM/Ollama with the dynamic persona system prompt from `src/utils/personaPromptBuilder.ts`.
- **Natural Voice TTS**:
  - **Persian**: `F5-TTS-Persian` or `XTTS-v2` / `ParsVoice` (with 5–10s reference audio zero-shot voice cloning).
  - **Multilingual & Emotion**: `CosyVoice 2` for expressive style-conditioned speech.
  - **Edge / CPU**: `Piper ONNX` for ultra-low-latency local synthesis.

Switch transports and engine routing anytime inside the **Voice & Persona -> Stack** tab.
