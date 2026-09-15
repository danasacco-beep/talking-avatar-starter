// Voice avatar server:
//   browser mic  --ws-->  this server  --ws-->  Deepgram Voice Agent (STT -> Claude via Deepgram -> TTS)
//   Deepgram TTS audio  --ws-->  browser  --> Anam audio passthrough --> lip-synced avatar video
//
// Both API keys stay on the server. The browser only ever sees a short-lived Anam session token
// and a same-origin WebSocket.
import "dotenv/config";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  ANAM_AVATAR_ID,
  ANAM_AVATAR_MODEL = "cara-4",
  THINK_MODEL = "claude-sonnet-5",
  SPEAK_MODEL = "flux-kit-en",
  LISTEN_MODEL = "flux-general-en",
  FLUX_EOT_THRESHOLD,
  FLUX_EAGER_EOT_THRESHOLD,
  FLUX_EOT_TIMEOUT_MS,
  PORT = 4400,
} = process.env;

// API keys live here at runtime. They start from .env and can be replaced from the page (POST /api/keys),
// which also writes them back to .env so they survive a restart.
const ENV_PATH = path.join(__dirname, ".env");
const keys = { anam: process.env.ANAM_API_KEY || "", deepgram: process.env.DEEPGRAM_API_KEY || "" };

function saveKeyToEnv(name, value) {
  let text = "";
  try { text = fs.readFileSync(ENV_PATH, "utf8"); } catch {}
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, text);
}
const mask = (k) => (k ? `••••${k.slice(-4)}` : "");

// Prompts live in prompts/*.md and are described by prompts/index.json. Each entry may declare
// `fields` (placeholders the user fills in per session, e.g. SECRET_FIGURE), a fixed `greeting`, or a
// `kickoff` (a hidden user message that makes the LLM produce its own in-character opening).
const PROMPTS_DIR = path.join(__dirname, "prompts");
function loadPrompts() {
  const index = JSON.parse(fs.readFileSync(path.join(PROMPTS_DIR, "index.json"), "utf8"));
  return index.map((entry) => {
    const text = fs.readFileSync(path.join(PROMPTS_DIR, entry.file), "utf8");
    if (text.length > 25000) console.warn(`[warn] ${entry.file} is ${text.length} chars; Deepgram caps prompts at 25,000`);
    return { ...entry, text };
  });
}
let PROMPTS = loadPrompts();

// Replace "[KEY — anything]" / "[KEY]" placeholders with the value the user supplied.
function fillPrompt(text, fields = [], values = {}) {
  let out = text;
  for (const f of fields) {
    const value = (values[f.key] || "").trim();
    if (!value && f.required) throw new Error(`Missing required field: ${f.label || f.key}`);
    out = out.replace(new RegExp(`\\[${f.key}[^\\]]*\\]`, "g"), value);
  }
  return out;
}

const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
const SAMPLE_RATE = 16000;

function buildSettings(promptEntry, values, voice = SPEAK_MODEL) {
  // Deepgram brokers the Anthropic call with its own credentials; there's no bring-your-own-key path.
  const think = {
    provider: { type: "anthropic", model: THINK_MODEL },
    prompt: fillPrompt(promptEntry.text, promptEntry.fields, values),
  };
  // Flux STT (flux-general-en / flux-general-multi) runs on the v2 API and adds model-integrated
  // end-of-turn detection; Nova models stay on v1 with none of the eot_* tuning fields.
  const listenProvider = { type: "deepgram", model: LISTEN_MODEL };
  if (LISTEN_MODEL.startsWith("flux")) {
    listenProvider.version = "v2";
    if (FLUX_EOT_THRESHOLD) listenProvider.eot_threshold = Number(FLUX_EOT_THRESHOLD);
    if (FLUX_EAGER_EOT_THRESHOLD) listenProvider.eager_eot_threshold = Number(FLUX_EAGER_EOT_THRESHOLD);
    if (FLUX_EOT_TIMEOUT_MS) listenProvider.eot_timeout_ms = Number(FLUX_EOT_TIMEOUT_MS);
  }
  const settings = {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: SAMPLE_RATE },
      output: { encoding: "linear16", sample_rate: SAMPLE_RATE, container: "none" },
    },
    agent: {
      language: "en",
      listen: { provider: listenProvider },
      think,
      speak: { provider: { type: "deepgram", model: voice } },
    },
  };
  // Flux TTS voices (flux-{voice}-{lang}) are the v2 API; Aura voices (aura-2-...) default to v1 when version is omitted.
  if (voice.startsWith("flux")) settings.agent.speak.provider.version = "v2";
  if (promptEntry.greeting) settings.agent.greeting = promptEntry.greeting;
  return settings;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor", express.static(path.join(__dirname, "node_modules/@anam-ai/js-sdk/dist/umd")));

// Avatars available to this Anam key (stock + custom). The list API pages at 100, so walk every page.
let avatarCache = { at: 0, list: [] };
async function listAvatars() {
  if (Date.now() - avatarCache.at < 10 * 60 * 1000 && avatarCache.list.length) return avatarCache.list;
  const list = [];
  for (let page = 1, last = 1; page <= last; page++) {
    const r = await fetch(`https://api.anam.ai/v1/avatars?perPage=100&page=${page}`, {
      headers: { Authorization: `Bearer ${keys.anam}` },
    });
    if (!r.ok) throw new Error(`Anam avatars ${r.status}: ${await r.text()}`);
    const body = await r.json();
    last = body.meta?.lastPage ?? 1;
    for (const a of body.data) {
      list.push({
        id: a.id,
        name: a.variantName ? `${a.displayName} — ${a.variantName}` : a.displayName,
        imageUrl: a.portraitImageUrl || a.imageUrl || null,
      });
    }
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  // Stock names repeat across variants; tag duplicates with a short id so the dropdown is unambiguous.
  const counts = new Map();
  for (const a of list) counts.set(a.name, (counts.get(a.name) || 0) + 1);
  for (const a of list) if (counts.get(a.name) > 1) a.name = `${a.name} (${a.id.slice(0, 4)})`;
  avatarCache = { at: Date.now(), list };
  return list;
}

// Deepgram TTS voices. Aura lives on /v1/models; Flux TTS (flux-{voice}-{lang}) is a separate
// catalog on /v2/models and never appears in /v1/models, so both must be fetched and merged.
let voiceCache = { at: 0, list: [] };
function toVoiceOption(m, group) {
  const meta = m.metadata || {};
  const lang = (m.languages || [])[0] || "";
  const gender = (meta.tags || []).find((t) => t === "feminine" || t === "masculine") || "";
  const display = meta.display_name || m.name.replace(/^\w/, (c) => c.toUpperCase());
  const bits = [meta.accent, gender].filter(Boolean).join(", ");
  return {
    id: m.canonical_name,
    name: `${display}${bits ? ` — ${bits}` : ""}${lang && !lang.startsWith("en") ? ` (${lang})` : ""}`,
    lang,
    architecture: m.architecture,
    group,
    sample: meta.sample || null,
  };
}
async function listVoices() {
  if (Date.now() - voiceCache.at < 10 * 60 * 1000 && voiceCache.list.length) return voiceCache.list;
  const headers = { Authorization: `Token ${keys.deepgram}` };
  const [auraRes, fluxRes] = await Promise.all([
    fetch("https://api.deepgram.com/v1/models", { headers }),
    fetch("https://api.deepgram.com/v2/models", { headers }),
  ]);
  if (!auraRes.ok) throw new Error(`Deepgram models ${auraRes.status}: ${await auraRes.text()}`);
  if (!fluxRes.ok) throw new Error(`Deepgram v2 models ${fluxRes.status}: ${await fluxRes.text()}`);
  const [auraBody, fluxBody] = await Promise.all([auraRes.json(), fluxRes.json()]);

  const flux = (fluxBody.tts || []).map((m) => toVoiceOption(m, "Flux (recommended)"));
  const auraEnglish = [];
  const auraOther = [];
  for (const m of auraBody.tts || []) {
    const isEnglish = ((m.languages || [])[0] || "").startsWith("en");
    (isEnglish ? auraEnglish : auraOther).push(toVoiceOption(m, isEnglish ? "Aura — English" : "Aura — Other languages"));
  }
  for (const group of [flux, auraEnglish, auraOther]) group.sort((a, b) => a.name.localeCompare(b.name));

  const list = [...flux, ...auraEnglish, ...auraOther];
  voiceCache = { at: Date.now(), list };
  return list;
}

app.get("/api/voices", async (_req, res) => {
  try {
    res.json({ defaultVoice: SPEAK_MODEL, voices: await listVoices() });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get("/api/avatars", async (_req, res) => {
  try {
    res.json({ defaultAvatarId: ANAM_AVATAR_ID, avatars: await listAvatars() });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Mint a short-lived Anam session token for the browser (audio passthrough mode).
// Body may carry { avatarId } chosen on the page; it must be one this key can use.
app.post("/api/anam-session", async (req, res) => {
  try {
    let avatarId = ANAM_AVATAR_ID;
    if (req.body?.avatarId) {
      const known = (await listAvatars()).some((a) => a.id === req.body.avatarId);
      if (!known) return res.status(400).json({ error: "Unknown avatarId" });
      avatarId = req.body.avatarId;
    }
    const r = await fetch("https://api.anam.ai/v1/auth/session-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keys.anam}` },
      body: JSON.stringify({
        personaConfig: {
          avatarId,
          avatarModel: ANAM_AVATAR_MODEL,
          enableAudioPassthrough: true,
        },
      }),
    });
    const body = await r.json();
    if (!r.ok) return res.status(r.status).json(body);
    res.json({ sessionToken: body.sessionToken });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Save keys pasted on the page. Each key is checked against its provider before it is accepted.
app.post("/api/keys", async (req, res) => {
  const result = {};
  const anam = (req.body?.anam || "").trim();
  const deepgram = (req.body?.deepgram || "").trim();
  if (anam) {
    const r = await fetch("https://api.anam.ai/v1/avatars?perPage=1", { headers: { Authorization: `Bearer ${anam}` } }).catch(() => null);
    if (r?.ok) { keys.anam = anam; avatarCache = { at: 0, list: [] }; saveKeyToEnv("ANAM_API_KEY", anam); result.anam = "ok"; }
    else result.anam = `Anam rejected this key${r ? ` (${r.status})` : ""}`;
  }
  if (deepgram) {
    const r = await fetch("https://api.deepgram.com/v1/projects", { headers: { Authorization: `Token ${deepgram}` } }).catch(() => null);
    if (r?.ok) { keys.deepgram = deepgram; voiceCache = { at: 0, list: [] }; saveKeyToEnv("DEEPGRAM_API_KEY", deepgram); result.deepgram = "ok"; }
    else result.deepgram = `Deepgram rejected this key${r ? ` (${r.status})` : ""}`;
  }
  res.json({ ...result, keyHints: { anam: mask(keys.anam), deepgram: mask(keys.deepgram) } });
});

app.get("/api/config", (_req, res) => {
  PROMPTS = loadPrompts(); // re-read on page load so prompt edits don't need a restart
  res.json({
    sampleRate: SAMPLE_RATE,
    thinkModel: THINK_MODEL,
    deepgramConfigured: Boolean(keys.deepgram),
    anamConfigured: Boolean(keys.anam),
    keyHints: { anam: mask(keys.anam), deepgram: mask(keys.deepgram) },
    prompts: PROMPTS.map(({ id, name, fields = [] }) => ({ id, name, fields })),
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/agent" });

// One upstream Deepgram socket per browser socket. Binary frames are audio in both directions;
// text frames are JSON control/events. The server sends Settings so the prompt and keys never leave it.
// The browser picks the prompt and fills its fields via the URL: /agent?prompt=<id>&SECRET_FIGURE=...
wss.on("connection", async (client, req) => {
  const params = new URL(req.url, "http://localhost").searchParams;
  const promptEntry = PROMPTS.find((p) => p.id === params.get("prompt")) || PROMPTS[0];
  const values = Object.fromEntries((promptEntry.fields || []).map((f) => [f.key, params.get(f.key) || ""]));

  // Voice must be one Deepgram actually offers; fall back to the .env default if the list can't be fetched.
  let voice = SPEAK_MODEL;
  const requested = params.get("voice");
  if (requested && requested !== SPEAK_MODEL) {
    try {
      if ((await listVoices()).some((v) => v.id === requested)) voice = requested;
      else console.warn(`[session] unknown voice "${requested}", using ${SPEAK_MODEL}`);
    } catch (err) {
      console.warn(`[session] could not verify voice: ${err.message}`);
    }
  }

  let settings;
  try {
    settings = buildSettings(promptEntry, values, voice);
  } catch (err) {
    client.send(JSON.stringify({ type: "Error", error: err.message }));
    client.close();
    return;
  }
  console.log(`[session] prompt=${promptEntry.id} voice=${voice}${Object.keys(values).length ? " " + JSON.stringify(values) : ""}`);

  const upstream = new WebSocket(DEEPGRAM_AGENT_URL, {
    headers: { Authorization: `Token ${keys.deepgram}` },
  });
  const pending = [];
  let keepAlive;
  let hideKickoffEcho = false;

  const sendClient = (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  };

  upstream.on("open", () => {
    upstream.send(JSON.stringify(settings));
    for (const msg of pending) upstream.send(msg.data, { binary: msg.isBinary });
    pending.length = 0;
    keepAlive = setInterval(() => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: "KeepAlive" }));
    }, 8000);
  });
  upstream.on("message", (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "Error" || msg.type === "Warning") console.warn("[deepgram]", msg);
        // Kickoff: once settings are live, nudge the LLM with a hidden user message so it opens in character.
        if (msg.type === "SettingsApplied" && promptEntry.kickoff) {
          hideKickoffEcho = true;
          upstream.send(JSON.stringify({ type: "InjectUserMessage", content: promptEntry.kickoff }));
        }
        if (hideKickoffEcho && msg.type === "ConversationText" && msg.role === "user" && msg.content === promptEntry.kickoff) {
          hideKickoffEcho = false;
          return; // don't show the nudge in the transcript
        }
      } catch {}
    }
    sendClient(data, isBinary);
  });
  upstream.on("close", (code, reason) => {
    console.log(`[deepgram] closed ${code} ${reason}`);
    sendClient(JSON.stringify({ type: "ProxyClosed", code, reason: reason.toString() }), false);
    client.close();
  });
  upstream.on("error", (err) => {
    console.error("[deepgram] error", err.message);
    sendClient(JSON.stringify({ type: "Error", error: `Deepgram connection failed: ${err.message}` }), false);
  });

  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else pending.push({ data, isBinary });
  });
  client.on("close", () => {
    clearInterval(keepAlive);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  });
});

// A port clash is the most common first-run failure, so it gets a plain-English line instead of a
// stack trace. The handler has to sit on BOTH objects: ws forwards the http server's "error" event to
// the WebSocketServer, and that forwarder is registered first — left unhandled it crashes the process
// before a listener on `server` alone would ever run.
let listenErrorReported = false;
function handleListenError(err) {
  if (listenErrorReported) return;
  listenErrorReported = true;
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Close the other app, or set PORT=4401 in .env and try again.`);
    process.exit(1);
  }
  throw err;
}
wss.on("error", handleListenError);
server.on("error", handleListenError);

// A novice reads this text as their only signal that the app worked, so it stays short and
// says what to do next. The keys line appears only while a key is still missing.
server.listen(PORT, () => {
  console.log("Talking Avatar is running.");
  console.log(`Open this in Chrome:  http://localhost:${PORT}`);
  if (!keys.anam || !keys.deepgram) {
    console.log("Then paste your Anam and Deepgram API keys into the box at the top of the page.");
  }
  console.log("Press Ctrl+C here to stop.");
});
