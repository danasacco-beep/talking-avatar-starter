# Deepgram × Claude × Anam voice avatar

A talking avatar: your mic goes to Deepgram's Voice Agent, which runs speech-to-text, calls Claude
through Deepgram's brokered Anthropic access, and synthesizes speech. The speech audio is piped into an
Anam avatar in audio-passthrough mode so the face lip-syncs to it.

```
mic ──PCM16──▶ ws /agent ──▶ Deepgram Voice Agent (nova-3 ▸ Claude ▸ aura-2)
                                      │ TTS PCM16
browser ◀─────────────────────────────┘
   └──▶ Anam createAgentAudioInputStream ──▶ lip-synced video + audio (WebRTC)
```

## Setup

1. `npm install` then `npm start`.
2. Open http://localhost:4400 and paste your Anam and Deepgram API keys into the **API keys** card
   (card 1, top of the right-hand column), then click **Save keys**. This is the normal way to set up:
   each key is checked with its provider before it is accepted, held in memory, and written to `.env`
   so it survives a restart. Nothing needs editing by hand and the app never prints your keys.
3. Click **Start conversation** and allow the microphone.

**Alternative:** if you would rather not use the page, create `.env` yourself (copy `.env.example`) and
set `ANAM_API_KEY` and `DEEPGRAM_API_KEY`. The page picks them up on the next start.

## Configuration (`.env`)

| Var | Purpose |
| --- | --- |
| `DEEPGRAM_API_KEY` | STT, TTS, and the brokered Claude call. Can be pasted on the page instead. |
| `THINK_MODEL` | Claude model. Brokered by Deepgram: `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`. |
| `ANTHROPIC_API_KEY` | Optional. If set, Deepgram calls Anthropic with your key instead, so any model works (e.g. `claude-opus-5`). |
| `ANAM_API_KEY` | Avatar rendering. Can be pasted on the page instead. |
| `ANAM_AVATAR_ID` | Stock avatar. List more with `curl -H "Authorization: Bearer $ANAM_API_KEY" https://api.anam.ai/v1/avatars`. |
| `SPEAK_MODEL` / `LISTEN_MODEL` | Deepgram voice and STT model. Both are only the initial defaults; the page overrides them. |
| `PORT` | Defaults to 4400. Set `PORT=4401` if something else already has that port. |

## Avatars

The **Avatar** dropdown lists every avatar your Anam key can use (stock and custom), fetched from
`GET /v1/avatars` and cached for ten minutes. The portrait shows in the video box until you start. Your last
choice is remembered. `ANAM_AVATAR_ID` in `.env` is only the initial default.

## Voices

The **Voice** dropdown lists every Deepgram text-to-speech voice, fetched live from Deepgram's models endpoint
(about 100, English first, other languages grouped below). The ▶ button plays Deepgram's sample clip for the
selected voice. `SPEAK_MODEL` in `.env` is only the initial default.

## Characters (prompts)

Pick a character from the **Character** dropdown before clicking Start. Prompts live in `prompts/`:

| Character | File | Notes |
| --- | --- | --- |
| Mystery guest | `prompts/mystery-guest.md` | Needs a **Secret figure** (e.g. Leonardo da Vinci). The character opens in voice and won't reveal its name until you guess it. |

`prompts/index.json` describes each one: `file`, optional `greeting` (spoken verbatim), optional `kickoff`
(a hidden nudge so the LLM writes its own opening), and optional `fields` (placeholders like `[SECRET_FIGURE …]`
that the page asks you to fill in). Add a new `.md` file plus an index entry to add a character; prompts are
re-read on every page load, so no restart is needed.

## Agent prompt

`AGENT-PROMPT.md` is a paste-ready brief for another AI agent to rebuild this whole project, with every API shape and gotcha. `INSTALL-GUIDE.md` is the novice class handout; students get the files themselves from the green **Code → Download ZIP** button at the top of this repo.

## Fullscreen

Click the ⛶ button on the avatar, double-click the video, or press **F**. Esc exits.

## How the pieces fit

- `server.js` serves the page, mints Anam session tokens with `enableAudioPassthrough: true`, and proxies the
  browser's WebSocket to `wss://agent.deepgram.com/v1/agent/converse`. It injects the `Settings` message
  itself, so the prompt and both API keys never reach the browser.
- `public/app.js` captures the mic with an AudioWorklet (16 kHz PCM16), forwards it to the proxy, and pushes
  Deepgram's TTS audio into the Anam stream. `UserStartedSpeaking` triggers `interruptPersona()` for barge-in;
  `AgentAudioDone` calls `endSequence()` to close the turn.
- The avatar's own microphone is disabled (`disableInputAudio: true`) so Anam never runs its own pipeline.
