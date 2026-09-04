# PROMPT — Build a Talking Avatar: Deepgram Voice Agent (STT → Claude → TTS) lip-synced by an Anam avatar

Paste this into an AI coding agent that has a shell, file editing, and outbound network access. Fill the bracketed values first. The agent should be able to reproduce a working local app in one session, with every API shape and gotcha below already known.

---

## Role & Goal

You are a coding agent building a browser app where a user talks into their microphone and a photoreal avatar talks back. Deliver a runnable Node project at **[PROJECT_DIR — e.g., ~/anam]** with:

- Speech-to-text, LLM, and text-to-speech all running inside **Deepgram's Voice Agent API** (one WebSocket). The LLM is **Claude, brokered by Deepgram** — no Anthropic key required.
- The TTS audio piped into an **Anam avatar in audio-passthrough mode**, so the face lip-syncs and the avatar's WebRTC stream carries the audio.
- A web page with: Start/Stop, avatar dropdown, character (system prompt) dropdown with per-prompt fill-in fields, microphone dropdown with level meter, live transcript, barge-in, and a fullscreen toggle.
- Both API keys and the system prompt held **server-side only**.

Inputs you need from the human before starting:

- `ANAM_API_KEY` — **[value]**
- `DEEPGRAM_API_KEY` — **[value]**. If the human says "find my Deepgram key," do a bounded search (env files, shell rc, keychain, browser localStorage) and then **stop and ask**: Deepgram never re-displays keys, so a new one from console.deepgram.com → API Keys is the fastest path. Do not spend more than a few minutes hunting.
- One or more system prompts (**[PROMPT_FILES]**), each becoming a selectable "character."

## Architecture (build exactly this shape)

```
browser mic ─PCM16 16 kHz─▶ ws://localhost:PORT/agent ─▶ Node proxy ─▶ wss://agent.deepgram.com/v1/agent/converse
                                                                 (server injects Settings: prompt + brokered Claude + voice)
browser ◀──── binary TTS PCM16 frames + JSON events ◀────────────┘
   └─▶ Anam JS SDK  createAgentAudioInputStream().sendAudioChunk()  ─▶ lip-synced video + audio via WebRTC
```

Why a proxy: browsers can't set the `Authorization` header on WebSockets, and the prompt should not ship to the client. The proxy also lets the page pick a prompt via query string.

## Phase 1 — Verify the APIs (do this before writing code)

### Deepgram Voice Agent API

- **URL** `wss://agent.deepgram.com/v1/agent/converse`, header `Authorization: Token <DEEPGRAM_API_KEY>`.
- **First message** must be `Settings`. Working, tested shape:

```json
{
  "type": "Settings",
  "audio": {
    "input":  { "encoding": "linear16", "sample_rate": 16000 },
    "output": { "encoding": "linear16", "sample_rate": 16000, "container": "none" }
  },
  "agent": {
    "language": "en",
    "listen": { "provider": { "type": "deepgram", "model": "nova-3" } },
    "think":  { "provider": { "type": "anthropic", "model": "claude-sonnet-5" }, "prompt": "<system prompt, ≤25,000 chars>" },
    "speak":  { "provider": { "type": "deepgram", "model": "aura-2-thalia-en" } },
    "greeting": "optional fixed opening line, spoken verbatim"
  }
}
```

- **Brokered Claude models** (no Anthropic key): `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5`. To use your own key or another model (e.g. `claude-opus-5`) add `"endpoint": {"url": "https://api.anthropic.com/v1/messages", "headers": {"x-api-key": "...", "anthropic-version": "2023-06-01"}}` inside `think`.
- **GOTCHA — do not send `temperature` inside `think.provider` for Anthropic models.** Speech recognition will work, then every turn fails with `{"type":"Error","code":"FAILED_TO_THINK","description":"Failed to think. Please check your agent.think settings."}`. Removing `temperature` fixed it for every model tested.
- Listen models: `nova-3`/`nova-2` need no version; `flux-general-en` requires `"version": "v2"`. Speak: Aura voices (`aura-2-*-en`) need no version; Flux TTS needs `"version": "v2"`.
- **Client → server messages:** binary frames = raw PCM16 mono at the input sample rate; `{"type":"KeepAlive"}` (send every ~8 s); `{"type":"InjectUserMessage","content":"..."}` (acts as if the user said it — use it to make the LLM generate its own in-character opening instead of a fixed greeting); `{"type":"InjectAgentMessage","message":"..."}` (agent speaks a literal string).
- **Server → client messages** in the order you will see them: `Welcome` → `SettingsApplied` → (greeting) `ConversationText{role:"assistant"}` + binary audio + `AgentAudioDone` → then per turn `UserStartedSpeaking` → `ConversationText{role:"user"}` → `AgentThinking` → `AgentStartedSpeaking` → `ConversationText{role:"assistant"}` (one per sentence) → binary audio → `AgentAudioDone`. Also `History`, `LatencyReport`, `Warning`, `Error`.
- **GOTCHA:** if you stop sending binary audio, Deepgram closes with `We did not receive audio within our timeout`. The browser mic keeps the stream alive; in Node tests, send 640-byte silence frames every 20 ms.
- **GOTCHA:** `InjectUserMessage` also emits `UserStartedSpeaking` and echoes the text as a user `ConversationText`. Filter that echo server-side if you hide the nudge from the transcript.

### Anam (avatar)

- **Mint a session token (server only):** `POST https://api.anam.ai/v1/auth/session-token`, header `Authorization: Bearer <ANAM_API_KEY>`, body:

```json
{ "personaConfig": { "avatarId": "<uuid>", "avatarModel": "cara-4", "enableAudioPassthrough": true } }
```

Response `{ "sessionToken": "<jwt>" }`. No `voiceId`/`llmId` in passthrough mode.

- **List avatars:** `GET https://api.anam.ai/v1/avatars?perPage=100&page=N` → `{ data: [{ id, displayName, variantName, portraitImageUrl, imageUrl, ... }], meta: { lastPage, ... } }`. Walk all pages (a fresh key sees ~120 stock avatars). Display names repeat across variants — disambiguate.
- **JS SDK:** `npm i @anam-ai/js-sdk` (4.27 tested). Serve `node_modules/@anam-ai/js-sdk/dist/umd/anam.js`; it defines `window.anam.createClient`. No bundler needed.
- **Client sequence (order matters):**

```js
const client = window.anam.createClient(sessionToken, { disableInputAudio: true }); // Anam must NOT capture the mic
await client.streamToVideoElement("avatar");                                          // must resolve before the next line
const stream = client.createAgentAudioInputStream({ encoding: "pcm_s16le", sampleRate: 16000, channels: 1 });
stream.sendAudioChunk(arrayBufferOrUint8ArrayOrBase64);   // every Deepgram binary frame, immediately
stream.endSequence();                                     // on AgentAudioDone, and on barge-in
client.interruptPersona();                                // on UserStartedSpeaking (barge-in), then endSequence()
await client.stopStreaming();                             // on Stop
```

- Anam **plays the audio itself** through the avatar's WebRTC stream, in sync with the lips. Do not also play the PCM locally or you get a double voice.
- Anam needs **800 ms of audio** buffered before it renders the first frame; Deepgram delivers faster than real time so this is fine. Sustained slower-than-realtime delivery causes stutter.
- Set `<video autoplay playsinline>` and use the avatar's `portraitImageUrl` as the `poster` before the stream starts.

## Phase 2 — Server (Node ≥ 20, ESM, `express` + `ws` + `dotenv`)

1. `package.json` with `"type": "module"` and `"start": "node server.js"`. Express 5 works.
2. `.env` (gitignored) holding `ANAM_API_KEY`, `ANAM_AVATAR_ID`, `ANAM_AVATAR_MODEL=cara-4`, `DEEPGRAM_API_KEY`, `THINK_MODEL=claude-sonnet-5`, optional `ANTHROPIC_API_KEY`, `SPEAK_MODEL`, `LISTEN_MODEL`, `PORT`. Ship a `.env.example`.
3. Routes:
   - `GET /` static `public/`; `GET /vendor/anam.js` static from the SDK's `dist/umd`.
   - `GET /api/config` → sample rate, model, whether Deepgram key is set, and the prompt list (`id`, `name`, `fields`). Re-read prompt files here so edits need no restart.
   - `GET /api/avatars` → all pages of Anam avatars, cached ~10 min, sorted, duplicates suffixed with a short id.
   - `POST /api/anam-session` `{ avatarId? }` → validate against the cached list, mint the passthrough token, return `{ sessionToken }`.
   - `WS /agent?prompt=<id>&<FIELD_KEY>=<value>` → per browser socket, open one upstream Deepgram socket with the auth header; queue client frames until upstream opens; send `Settings` from the server; pipe binary both ways preserving `isBinary`; send `KeepAlive` every 8 s; forward upstream `Error`s to the client as JSON and log them; close both sides together.
4. **Prompt system:** `prompts/index.json` is an array of `{ id, name, file, greeting?, kickoff?, fields?: [{ key, label, placeholder, required }] }`. Fill placeholders written as `[KEY — any explanation]` or `[KEY]` with the regex `\[KEY[^\]]*\]`. Reject the connection with a JSON `Error` if a required field is empty. If `kickoff` is set, omit `greeting` and, on `SettingsApplied`, send `InjectUserMessage` with the kickoff text; drop the matching user `ConversationText` echo.
5. **GOTCHA — port 3000** is often taken (Langfuse, Next apps). Pick something like 4400.

## Phase 3 — Browser client (plain JS, no bundler)

1. On load: fetch config and avatars; fill the **Avatar**, **Character**, and **Microphone** dropdowns; remember choices in `localStorage`.
2. **Mic permission up front:** call `getUserMedia({audio:true})`, stop the tracks, then `enumerateDevices()` — device labels are empty until permission is granted. Re-list on `devicechange`. Keep an "Allow mic" button for when the prompt was dismissed.
3. **Capture:** `new AudioContext({ sampleRate: 16000 })` (Chrome resamples), an `AudioWorkletProcessor` that converts Float32 → Int16 and posts 640-sample (40 ms) buffers; main thread sends each buffer as a binary WebSocket frame and drives a simple RMS level bar. Use `echoCancellation`, `noiseSuppression`, `autoGainControl`. Don't connect the source to `destination`. Support switching mics mid-call by rebuilding the capture chain only.
4. **Start order:** validate required prompt fields → mint Anam session → `streamToVideoElement` → create the audio input stream → open the `/agent` socket → wait for `SettingsApplied` → start the mic. Wire the events exactly as in the Anam sequence above; render `ConversationText` into the transcript.
5. **Stop:** close the socket, disconnect the worklet, stop tracks, close the AudioContext, `stopStreaming()`, clear `video.srcObject`, restore the poster.
6. **Fullscreen:** wrap the video in a `#stage` div and call `requestFullscreen()` on the wrapper so an overlay toggle button stays reachable; also bind double-click and the `F` key (ignored while typing in inputs). Style `#stage:fullscreen video { object-fit: contain }`.
7. Tell users to wear headphones; otherwise the avatar hears itself.

## Phase 4 — Verify without a browser (you may not be able to drive one)

Tool-driven browsers often cannot reach `localhost` from an agent session, and a permission classifier may block navigation. Verify from Node instead:

1. Syntax: `node --check` on every file.
2. Endpoints: `curl` `/api/config`, `/api/avatars`, `POST /api/anam-session` with a valid and an invalid `avatarId`.
3. **Proxy with no key:** connecting to `/agent` should yield a JSON `Error` mentioning a 401 — proves the proxy path.
4. **Full talk loop:** synthesize a question on macOS with `say -o q.aiff "…"` then `afconvert q.aiff -d LEI16@16000 -c 1 -f WAVE q.wav`; strip the WAV header by slicing after the `data` chunk; open `ws://127.0.0.1:PORT/agent?prompt=…`; after the greeting's `AgentAudioDone`, send the PCM in 640-byte frames every 20 ms, then continuous silence frames; expect `[user]` transcript text, `[assistant]` reply text, and a nonzero count of reply audio bytes. Run this for **every prompt**, including a case with a required field missing.
5. If a turn fails with `FAILED_TO_THINK`, bisect with direct Deepgram connections varying model / prompt length / provider fields in parallel. The `temperature` field was the culprit in this build.

## Gotchas checklist (all hit in practice)

- `think.provider.temperature` → `FAILED_TO_THINK` on Anthropic models. Omit it.
- Prompt cap is 25,000 chars; warn when a file exceeds it.
- Deepgram closes the socket if no audio arrives; tests must send silence.
- `createAgentAudioInputStream` must be called after `streamToVideoElement` resolves.
- `disableInputAudio: true` is mandatory, or Anam runs its own STT/LLM on the mic.
- Don't locally play the TTS PCM; Anam plays it.
- Anam avatar names repeat; key dropdowns by id.
- Mic labels are blank before permission; ask early.
- `AudioContext({sampleRate:16000})` avoids hand-written resampling in Chrome.
- Port 3000 is frequently occupied; in Chrome a stale service on the same port can shadow yours.
- Keep API keys and prompts server-side; the page only ever holds an Anam session token.
- Never re-request the human's Deepgram key by scraping their browser; ask them.

## Deliverables (report at the end)

- File tree: `server.js`, `public/index.html`, `public/app.js`, `public/mic-worklet.js`, `prompts/index.json`, `prompts/*.md`, `.env`, `.env.example`, `README.md`.
- The URL to open, the exact click path (allow mic → pick avatar → pick character → fill fields → Start), and the headphones note.
- Verification transcript for each prompt: the synthesized question, the recognized text, the reply text, and the reply audio duration.
- Anything unverified (e.g., the live page in a real browser) stated plainly, and every default you chose (model, voice, avatar) with how to change it.
