// Browser orchestration:
//   mic -> AudioWorklet (PCM16 @ 16 kHz) -> ws /agent -> Deepgram Voice Agent
//   Deepgram TTS PCM16 -> Anam audio passthrough -> lip-synced avatar (video + audio via WebRTC)
const { createClient } = window.anam;

const els = {
  start: document.getElementById("start"),
  stop: document.getElementById("stop"),
  status: document.getElementById("status"),
  transcript: document.getElementById("transcript"),
  video: document.getElementById("avatar"),
  meta: document.getElementById("meta"),
  mic: document.getElementById("mic"),
  micPerm: document.getElementById("micPerm"),
  levelBar: document.getElementById("levelBar"),
  prompt: document.getElementById("prompt"),
  promptFields: document.getElementById("promptFields"),
  avatarSelect: document.getElementById("avatar-select"),
  voice: document.getElementById("voice"),
  preview: document.getElementById("preview"),
  anamKey: document.getElementById("anamKey"),
  deepgramKey: document.getElementById("deepgramKey"),
  saveKeys: document.getElementById("saveKeys"),
  keysState: document.getElementById("keysState"),
  keysMsg: document.getElementById("keysMsg"),
  voiceRow: document.getElementById("voiceRow"),
  rawConfigInput: document.getElementById("rawConfig"),
  applyConfig: document.getElementById("applyConfig"),
  clearConfig: document.getElementById("clearConfig"),
  configMsg: document.getElementById("configMsg"),
};
let keysReady = false;

// Show which keys the server has (masked hints only; the page never receives the real values).
function showKeyState(cfg) {
  const hints = cfg.keyHints || {};
  els.anamKey.placeholder = hints.anam ? `Saved ${hints.anam} — paste to replace` : "Paste your Anam API key";
  els.deepgramKey.placeholder = hints.deepgram ? `Saved ${hints.deepgram} — paste to replace` : "Paste your Deepgram API key";
  els.anamKey.classList.toggle("saved", Boolean(hints.anam));
  els.deepgramKey.classList.toggle("saved", Boolean(hints.deepgram));
  keysReady = Boolean(hints.anam && hints.deepgram);
  els.keysState.textContent = keysReady ? "Both keys saved" : hints.anam ? "Deepgram key needed" : hints.deepgram ? "Anam key needed" : "Both keys needed";
  els.keysState.className = `keys-state ${keysReady ? "ok" : "missing"}`;
  els.start.disabled = !keysReady;
}

async function saveKeys() {
  const anam = els.anamKey.value.trim();
  const deepgram = els.deepgramKey.value.trim();
  if (!anam && !deepgram) { els.keysMsg.textContent = "Paste at least one key first."; els.keysMsg.className = "keys-msg error"; return; }
  els.saveKeys.disabled = true;
  els.keysMsg.textContent = "Checking with the providers…";
  els.keysMsg.className = "keys-msg";
  try {
    const r = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anam, deepgram }) });
    const body = await r.json();
    const problems = ["anam", "deepgram"].filter((k) => body[k] && body[k] !== "ok").map((k) => body[k]);
    els.keysMsg.textContent = problems.length ? problems.join(". ") : "Saved. Keys verified and written to .env.";
    els.keysMsg.className = `keys-msg ${problems.length ? "error" : "ok"}`;
    if (body.anam === "ok") els.anamKey.value = "";
    if (body.deepgram === "ok") els.deepgramKey.value = "";
    showKeyState(body);
    // Lists depend on the keys, so refresh them.
    if (body.anam === "ok") loadAvatars();
    if (body.deepgram === "ok") loadVoices();
  } catch (err) {
    els.keysMsg.textContent = `Could not save: ${err.message}`;
    els.keysMsg.className = "keys-msg error";
  } finally {
    els.saveKeys.disabled = false;
  }
}
let prompts = [];
let avatars = [];
let voices = [];
let previewAudio = null;

async function loadVoices() {
  try {
    const r = await fetch("/api/voices");
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    voices = body.voices;
    els.voice.innerHTML = "";
    // Server groups voices by engine (Flux first, then Aura by language); keep that order here.
    const groups = new Map();
    for (const v of voices) {
      if (!groups.has(v.group)) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = v.group;
        groups.set(v.group, optgroup);
        els.voice.appendChild(optgroup);
      }
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.name;
      groups.get(v.group).appendChild(opt);
    }
    let chosen = body.defaultVoice;
    try { chosen = localStorage.getItem("voice") || chosen; } catch {}
    if (voices.some((v) => v.id === chosen)) els.voice.value = chosen;
    els.preview.hidden = !voices.find((v) => v.id === els.voice.value)?.sample;
  } catch (err) {
    els.voice.innerHTML = `<option value="">Could not load voices: ${err.message}</option>`;
    els.preview.hidden = true;
  }
}

// Play Deepgram's own sample clip for the selected voice (no API call, just an audio file).
function previewVoice() {
  const v = voices.find((x) => x.id === els.voice.value);
  if (!v?.sample) return;
  if (previewAudio) { previewAudio.pause(); previewAudio = null; els.preview.textContent = "▶"; return; }
  previewAudio = new Audio(v.sample);
  els.preview.textContent = "■";
  previewAudio.onended = previewAudio.onerror = () => { previewAudio = null; els.preview.textContent = "▶"; };
  previewAudio.play().catch(() => { previewAudio = null; els.preview.textContent = "▶"; });
}

function showAvatarPreview() {
  const a = avatars.find((x) => x.id === els.avatarSelect.value);
  els.video.poster = a?.imageUrl || "";
}

async function loadAvatars() {
  try {
    const r = await fetch("/api/avatars");
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    avatars = body.avatars;
    els.avatarSelect.innerHTML = "";
    for (const a of avatars) {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.name;
      els.avatarSelect.appendChild(opt);
    }
    let chosen = body.defaultAvatarId;
    try { chosen = localStorage.getItem("avatarId") || chosen; } catch {}
    if (avatars.some((a) => a.id === chosen)) els.avatarSelect.value = chosen;
    showAvatarPreview();
  } catch (err) {
    els.avatarSelect.innerHTML = `<option value="">Could not load avatars: ${err.message}</option>`;
  }
}

function renderPromptFields() {
  const entry = prompts.find((p) => p.id === els.prompt.value);
  els.promptFields.innerHTML = "";
  for (const f of entry?.fields || []) {
    const label = document.createElement("label");
    label.textContent = f.label || f.key;
    const input = document.createElement("input");
    input.name = f.key;
    input.placeholder = f.placeholder || "";
    input.required = Boolean(f.required);
    try { input.value = localStorage.getItem(`field:${entry.id}:${f.key}`) || ""; } catch {}
    input.oninput = () => { try { localStorage.setItem(`field:${entry.id}:${f.key}`, input.value); } catch {} };
    if (f.secret) {
      // Masked like a password field so whoever is setting this up doesn't spoil it for the
      // player reading over their shoulder; the eye button lets them double-check what they typed.
      input.type = "password";
      const wrap = document.createElement("div");
      wrap.className = "secret-field";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "small";
      toggle.textContent = "👁";
      toggle.setAttribute("aria-label", "Show");
      toggle.onclick = () => {
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        toggle.textContent = showing ? "👁" : "🙈";
        toggle.setAttribute("aria-label", showing ? "Show" : "Hide");
      };
      wrap.append(input, toggle);
      label.appendChild(wrap);
    } else {
      label.appendChild(input);
    }
    els.promptFields.appendChild(label);
  }
}

// Build the /agent URL. The Character prompt/fields are always sent and always validated — even
// with a pasted config active, the server prepends that compiled prompt to whatever the config's
// own prompt says, so a pasted config can never accidentally replace the game. A pasted config only
// adds ?override=1, which tells the server to wait for it as the first WebSocket message and use
// its model/voice/audio settings instead of the Voice dropdown's.
function agentUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = new URL(`${proto}://${location.host}/agent`);
  if (pastedConfig) url.searchParams.set("override", "1");
  url.searchParams.set("prompt", els.prompt.value);
  if (els.voice.value) url.searchParams.set("voice", els.voice.value);
  for (const input of els.promptFields.querySelectorAll("input")) {
    if (input.required && !input.value.trim()) throw new Error(`Please fill in "${input.closest("label").firstChild.textContent}" first.`);
    url.searchParams.set(input.name, input.value.trim());
  }
  return url.toString();
}

let anamClient, audioInputStream, ws, audioCtx, micStream, workletNode;
let sampleRate = 16000;
let lastCfg = null;
// The parsed Settings object from a pasted Deepgram Playground config, or null for the normal
// Voice-dropdown flow. When set, it replaces the Voice/model/audio settings for the next session —
// but never the Character prompt; the server always prepends that (see agentUrl and server.js).
let pastedConfig = null;

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
}

function updateMetaLine() {
  if (pastedConfig) {
    const think = Array.isArray(pastedConfig.agent?.think) ? pastedConfig.agent.think[0] : pastedConfig.agent?.think;
    const model = think?.provider?.model || think?.provider?.type || "custom";
    els.meta.textContent = `LLM: ${model} (pasted config)`;
  } else {
    els.meta.textContent = `LLM: ${lastCfg?.thinkModel || "…"}`;
  }
}

// A pasted config carries its own model and voice, so the Voice select would otherwise sit there
// looking editable while being silently ignored — grey it out. The Character card stays live: its
// compiled prompt (and the secret figure you set) always gets prepended server-side, so it's never
// optional, override or not.
function setConfigOverrideActive(active) {
  els.voiceRow.classList.toggle("disabled-by-config", active);
  for (const el of els.voiceRow.querySelectorAll("select, button")) el.disabled = active;
  els.clearConfig.hidden = !active;
  updateMetaLine();
}

// Basic sanity checks so a bad paste fails with a clear message instead of a confusing runtime
// error later. Deepgram's own validation catches everything else once the session connects.
function parseRawConfig(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("That's not valid JSON — check for a missing comma or bracket."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object, not a list or plain value.");
  if (!parsed.agent || typeof parsed.agent !== "object") throw new Error('Missing "agent" — this doesn\'t look like a Voice Agent Settings payload.');
  const audioOk = (io) => !io || (io.encoding === "linear16" && (!io.container || io.container === "none"));
  if (!audioOk(parsed.audio?.input) || !audioOk(parsed.audio?.output)) {
    throw new Error("This app only supports linear16 audio with no container — re-export from the Playground with that audio setting.");
  }
  return parsed;
}

els.applyConfig.onclick = () => {
  try {
    pastedConfig = parseRawConfig(els.rawConfigInput.value);
    try { localStorage.setItem("rawConfig", els.rawConfigInput.value); } catch {}
    els.configMsg.textContent = "Applied — Start conversation will use this instead of the Voice setting above (the Character prompt is always kept).";
    els.configMsg.className = "keys-msg ok";
  } catch (err) {
    pastedConfig = null;
    els.configMsg.textContent = err.message;
    els.configMsg.className = "keys-msg error";
  }
  setConfigOverrideActive(Boolean(pastedConfig));
};
els.clearConfig.onclick = () => {
  pastedConfig = null;
  els.configMsg.textContent = "";
  els.configMsg.className = "keys-msg";
  setConfigOverrideActive(false);
};

function addLine(role, text) {
  const row = document.createElement("div");
  row.className = `line ${role}`;
  row.innerHTML = `<span class="who">${role === "user" ? "You" : "Avatar"}</span><span class="text"></span>`;
  row.querySelector(".text").textContent = text;
  els.transcript.appendChild(row);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

async function loadConfig() {
  const cfg = await fetch("/api/config").then((r) => r.json());
  sampleRate = cfg.sampleRate;
  lastCfg = cfg;
  updateMetaLine();
  showKeyState(cfg);
  if (!keysReady) setStatus("Add your API keys to begin", "muted");
  prompts = cfg.prompts;
  els.prompt.innerHTML = "";
  for (const p of prompts) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    els.prompt.appendChild(opt);
  }
  try { const saved = localStorage.getItem("prompt"); if (prompts.some((p) => p.id === saved)) els.prompt.value = saved; } catch {}
  renderPromptFields();
  // Restore whatever was last pasted so it's not lost on refresh, but require a fresh click on
  // Apply before it takes effect — silently re-activating an override isn't the safer default.
  try { els.rawConfigInput.value = localStorage.getItem("rawConfig") || ""; } catch {}
  return cfg;
}

async function startAvatar() {
  const r = await fetch("/api/anam-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avatarId: els.avatarSelect.value || undefined }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Anam session failed: ${JSON.stringify(body)}`);
  anamClient = createClient(body.sessionToken, { disableInputAudio: true });
  await anamClient.streamToVideoElement("avatar");
  audioInputStream = anamClient.createAgentAudioInputStream({
    encoding: "pcm_s16le",
    // A pasted config can declare its own output sample rate (e.g. Flux TTS at 24 kHz); Anam's
    // playback stream has to match whatever Deepgram is actually about to send, not our default.
    sampleRate: pastedConfig?.audio?.output?.sample_rate || sampleRate,
    channels: 1,
  });
}

function connectAgent() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(agentUrl());
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      // In override mode this is the very first thing sent, before any mic audio — the server
      // waits for it and relays it to Deepgram in place of its own built-in Settings.
      if (pastedConfig) ws.send(JSON.stringify({ type: "ClientSettings", settings: pastedConfig }));
      setStatus("Connected to Deepgram, applying settings…");
    };
    ws.onerror = () => reject(new Error("WebSocket error"));
    ws.onclose = () => setStatus("Disconnected", "muted");
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        // Deepgram TTS audio -> avatar lip-sync. Anam plays the audio itself, in sync with the face.
        audioInputStream?.sendAudioChunk(ev.data);
        return;
      }
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case "Welcome": break;
        case "SettingsApplied":
          setStatus("Listening — start talking", "live");
          resolve();
          break;
        case "ConversationText":
          addLine(msg.role === "user" ? "user" : "assistant", msg.content);
          break;
        case "UserStartedSpeaking":
          // Barge-in: stop the avatar immediately and reset the audio sequence.
          anamClient?.interruptPersona();
          audioInputStream?.endSequence();
          setStatus("Listening…", "live");
          break;
        case "AgentThinking":
          setStatus("Thinking…", "live");
          break;
        case "AgentStartedSpeaking":
          setStatus("Speaking…", "live");
          break;
        case "AgentAudioDone":
          audioInputStream?.endSequence();
          setStatus("Listening — start talking", "live");
          break;
        case "Error":
        case "ProxyClosed":
          setStatus(msg.error || msg.description || `Connection closed (${msg.code}) ${msg.reason || ""}`, "error");
          if (msg.type === "Error") reject(new Error(msg.error || msg.description));
          break;
        default:
          break;
      }
    };
  });
}

// Ask the browser for mic permission up front so device labels become visible, then fill the dropdown.
async function requestMicPermission() {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
  } catch (err) {
    setStatus(`Microphone blocked: ${err.message}. Click the camera/mic icon in the address bar to allow it.`, "error");
    return false;
  }
  await listMics();
  return true;
}

async function listMics() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter((d) => d.kind === "audioinput");
  const previous = els.mic.value;
  els.mic.innerHTML = "";
  if (mics.length === 0) {
    els.mic.innerHTML = '<option value="">No microphone found</option>';
    return;
  }
  for (const [i, d] of mics.entries()) {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microphone ${i + 1}`;
    els.mic.appendChild(opt);
  }
  if (previous && mics.some((d) => d.deviceId === previous)) els.mic.value = previous;
  els.micPerm.hidden = mics.every((d) => d.label);
}

function showLevel(int16Buffer) {
  const samples = new Int16Array(int16Buffer);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length) / 32768;
  els.levelBar.style.width = `${Math.min(100, rms * 400)}%`;
}

async function startMic() {
  const deviceId = els.mic.value;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    },
  });
  await listMics(); // labels are available now that permission is granted
  // A pasted config can request its own input sample rate (e.g. 48 kHz) — capture at that rate so
  // it matches what we declared to Deepgram in the ClientSettings/Settings message.
  audioCtx = new AudioContext({ sampleRate: pastedConfig?.audio?.input?.sample_rate || sampleRate });
  await audioCtx.audioWorklet.addModule("/mic-worklet.js");
  const source = audioCtx.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(audioCtx, "pcm-capture");
  workletNode.port.onmessage = (ev) => {
    showLevel(ev.data);
    if (ws?.readyState === WebSocket.OPEN) ws.send(ev.data);
  };
  source.connect(workletNode);
  // Not connected to destination: we don't want to hear our own mic.
}

async function start() {
  els.start.disabled = true;
  els.transcript.innerHTML = "";
  try {
    agentUrl(); // validate required fields before spending an Anam session
    setStatus("Starting avatar…");
    await startAvatar();
    setStatus("Connecting to Deepgram…");
    await connectAgent();
    await startMic();
    els.stop.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus(err.message, "error");
    await stop();
  }
}

async function stop() {
  els.stop.disabled = true;
  try { ws?.close(); } catch {}
  try { workletNode?.disconnect(); } catch {}
  try { micStream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { await audioCtx?.close(); } catch {}
  try { await anamClient?.stopStreaming(); } catch {}
  ws = workletNode = micStream = audioCtx = anamClient = audioInputStream = null;
  els.video.srcObject = null;
  showAvatarPreview(); // bring the portrait back once the live stream is gone
  els.levelBar.style.width = "0";
  els.start.disabled = !keysReady;
  setStatus("Stopped", "muted");
}

// Switching mics mid-conversation swaps the capture source without touching the Deepgram session.
els.mic.onchange = async () => {
  if (!micStream) return;
  try {
    workletNode?.disconnect();
    micStream.getTracks().forEach((t) => t.stop());
    await audioCtx?.close();
    await startMic();
  } catch (err) {
    setStatus(`Could not switch microphone: ${err.message}`, "error");
  }
};
els.saveKeys.onclick = saveKeys;
for (const input of [els.anamKey, els.deepgramKey]) input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") saveKeys(); });
els.voice.onchange = () => {
  try { localStorage.setItem("voice", els.voice.value); } catch {}
  if (previewAudio) { previewAudio.pause(); previewAudio = null; els.preview.textContent = "▶"; }
  els.preview.hidden = !voices.find((v) => v.id === els.voice.value)?.sample;
};
els.preview.onclick = previewVoice;
els.avatarSelect.onchange = () => {
  try { localStorage.setItem("avatarId", els.avatarSelect.value); } catch {}
  showAvatarPreview();
};
els.prompt.onchange = () => {
  try { localStorage.setItem("prompt", els.prompt.value); } catch {}
  renderPromptFields();
};
// Fullscreen: the stage wrapper goes fullscreen (not the bare video) so the toggle button stays reachable.
const stage = document.getElementById("stage");
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen().catch((err) => setStatus(`Fullscreen failed: ${err.message}`, "error"));
}
document.getElementById("fullscreen").onclick = toggleFullscreen;
els.video.ondblclick = toggleFullscreen;
document.addEventListener("keydown", (ev) => {
  if (ev.key.toLowerCase() === "f" && !["INPUT", "SELECT", "TEXTAREA"].includes(ev.target.tagName)) toggleFullscreen();
});
els.micPerm.onclick = requestMicPermission;
els.start.onclick = start;
els.stop.onclick = stop;
navigator.mediaDevices.addEventListener("devicechange", listMics);
loadAvatars();
loadVoices();
loadConfig().then(requestMicPermission);
