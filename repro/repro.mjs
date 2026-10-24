/**
 * Minimal reproductions of the Boson Realtime findings in ../reports/.
 *
 *   node repro/repro.mjs b1|b2|b2c|b2d|b3|b4|all
 *
 * No dependencies (Node 22+ has WebSocket and fetch). The key comes from
 * BOSON_API_KEY, from the file named by BOSON_API_KEY_FILE, or from a .env in
 * the current folder. It is used only to mint a 10-minute ephemeral key and to
 * call TTS; neither key is ever written to the log.
 *
 * The "user" is synthetic: Higgs TTS speech streamed in 100 ms chunks at real
 * time, with silence between utterances, the way a microphone streams. No real
 * person's voice is used. Each run writes e2e_logs/feedback/<scenario>-<time>.jsonl
 * (every event both ways, audio payloads replaced by their size) and a
 * .summary.json with the counts each report quotes.
 *
 *   b1  response.cancel sent on response.created, before any output, then the
 *       user speaks again. Docs: response.done is "emitted exactly once per
 *       response_id"; the cancelled response "finishes with response.done
 *       (status: cancelled)".
 *   b2  a second session.update changes turn_detection and instructions. Is
 *       the socket closed (client-events) or is the old config kept
 *       (tool-calling)? Do the new instructions apply? Then a control update
 *       without turn_detection.
 *   b3  three plain spoken turns, no cancels. Count
 *       conversation.item.input_audio_transcription.completed per item_id
 *       (docs: "Final transcript of a user audio turn").
 *   b4  on speech_stopped, add a user text item and send response.create at
 *       once (FEEDBACK_DELAY_MS to shift it). Docs: "With server VAD, any
 *       in-flight response is interrupted first." Records the full error object.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";

const BASE = (process.env.BOSON_BASE_URL ?? "https://api.boson.ai").replace(/\/$/, "");
const WS_URL = BASE.replace(/^http/, "ws") + "/v1/realtime?model=higgs-realtime";
const RATE = 24000;
const CHUNK = RATE / 10; // 100 ms of PCM16 mono

function loadKey() {
  if (process.env.BOSON_API_KEY?.trim()) return process.env.BOSON_API_KEY.trim();
  if (process.env.BOSON_API_KEY_FILE) return readFileSync(process.env.BOSON_API_KEY_FILE, "utf8").trim();
  if (existsSync(".env")) {
    const env = Object.fromEntries(
      readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => /^\s*[A-Z_]+\s*=/.test(l))
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
    );
    if (env.BOSON_API_KEY) return env.BOSON_API_KEY;
    if (env.BOSON_API_KEY_FILE) return readFileSync(env.BOSON_API_KEY_FILE, "utf8").trim();
  }
  throw new Error("No key: set BOSON_API_KEY or BOSON_API_KEY_FILE, or run from a folder whose .env has one.");
}
const KEY = loadKey();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n) => String(Math.abs(n)).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 23);
  return `${local}${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
};

/** Response headers worth quoting in a report (request ids), never auth. */
function idHeaders(res) {
  const out = {};
  res.headers.forEach((v, k) => { if (/request|trace|correlation/i.test(k)) out[k] = v; });
  return out;
}

async function ephemeralKey() {
  const res = await fetch(`${BASE}/v1/realtime/client_secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expires_after: { seconds: 600 } }),
  });
  if (!res.ok) throw new Error(`client_secrets ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return { value: body.value ?? body.client_secret?.value, headers: idHeaders(res) };
}

const ttsCache = new Map();
async function speech(text) {
  if (ttsCache.has(text)) return ttsCache.get(text);
  const res = await fetch(`${BASE}/v1/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "higgs-tts-3", input: text, voice: "jake", response_format: "pcm", stream: false }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  ttsCache.set(text, buf);
  return buf;
}

/** One logged Realtime session with a synthetic microphone. */
class Session {
  constructor(name) {
    mkdirSync("e2e_logs/feedback", { recursive: true });
    const tag = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.file = `e2e_logs/feedback/${name}-${tag}`;
    this.name = name;
    this.t0 = performance.now();
    this.events = [];
    this.handlers = [];
    this.queue = [];
    this.closed = null;
  }

  log(dir, evt) {
    const slim = JSON.parse(JSON.stringify(evt, (k, v) =>
      (k === "audio" || (k === "delta" && evt.type === "response.output_audio.delta")) && typeof v === "string"
        ? `<${Buffer.from(v, "base64").length} bytes>` : v));
    const rec = { t_ms: Math.round(performance.now() - this.t0), at: stamp(), dir, ...slim };
    if (!(dir === "out" && evt.type === "input_audio_buffer.append")) {
      this.events.push(rec);
      appendFileSync(`${this.file}.jsonl`, JSON.stringify(rec) + "\n");
    }
    if (dir === "in") {
      const brief = evt.type === "error" ? JSON.stringify(evt.error)
        : evt.response?.id ?? evt.response_id ?? evt.item_id ?? evt.item?.id ?? "";
      if (!/delta$/.test(evt.type)) console.log(`${String(rec.t_ms).padStart(6)} ms  <- ${evt.type} ${brief}`);
    } else if (evt.type !== "input_audio_buffer.append") {
      console.log(`${String(rec.t_ms).padStart(6)} ms  -> ${evt.type} ${evt.response_id ?? ""}`);
    }
  }

  async open() {
    const eph = await ephemeralKey();
    this.meta = { scenario: this.name, started: stamp(), ws_url: WS_URL, client_secret_headers: eph.headers };
    this.ws = new WebSocket(WS_URL, ["realtime", `bai-client-secret.${eph.value}`]);
    await new Promise((ok, fail) => { this.ws.onopen = ok; this.ws.onerror = () => fail(new Error("socket error on open")); });
    this.ws.onmessage = (m) => {
      const evt = JSON.parse(m.data);
      this.log("in", evt);
      for (const h of [...this.handlers]) h(evt);
    };
    this.ws.onclose = (e) => {
      this.closed = { code: e.code, reason: e.reason, t_ms: Math.round(performance.now() - this.t0), at: stamp() };
      console.log(`socket closed ${e.code} ${e.reason}`);
    };
    // The microphone: always streaming, speech when queued, silence otherwise.
    this.mic = setInterval(() => {
      if (this.ws.readyState !== 1) return;
      const next = this.queue.shift();
      const chunk = next ?? Buffer.alloc(CHUNK * 2);
      if (next && this.queue.length === 0 && this.saying) { const r = this.saying; this.saying = null; setTimeout(r, 100); }
      this.send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") });
    }, 100);
  }

  send(evt) { this.log("out", evt); this.ws.send(JSON.stringify(evt)); }
  on(fn) { this.handlers.push(fn); return () => (this.handlers = this.handlers.filter((h) => h !== fn)); }

  /** Resolves with the first server event matching `pred`, or null after `ms`. */
  next(pred, ms = 15000) {
    return new Promise((ok) => {
      const timer = setTimeout(() => { off(); ok(null); }, ms);
      const off = this.on((e) => { if (pred(e)) { clearTimeout(timer); off(); ok(e); } });
    });
  }

  async configure(extra = {}) {
    this.send({ type: "session.update", session: config(extra) });
    return this.next((e) => e.type === "session.created" || e.type === "session.updated" || e.type === "error");
  }

  /** Speak `text` into the mic; resolves when its last sample has been sent. */
  async say(text) {
    const pcm = await speech(text);
    for (let i = 0; i < pcm.length; i += CHUNK * 2) this.queue.push(pcm.subarray(i, i + CHUNK * 2));
    console.log(`         (user says: "${text}", ${(pcm.length / 2 / RATE).toFixed(1)} s)`);
    return new Promise((r) => (this.saying = r));
  }

  /** Wait until no server event other than audio has arrived for `quietMs`. */
  async settle(quietMs = 6000, maxMs = 45000) {
    const start = performance.now();
    let last = performance.now();
    const off = this.on((e) => { if (!/audio\.delta|transcript\.delta/.test(e.type)) last = performance.now(); });
    while (performance.now() - last < quietMs && performance.now() - start < maxMs && !this.closed) await sleep(200);
    off();
  }

  async close(extraSummary = {}) {
    clearInterval(this.mic);
    if (this.ws.readyState === 1) this.ws.close(1000);
    await sleep(300);
    const summary = { ...this.meta, ended: stamp(), close: this.closed, ...summarize(this.events), ...extraSummary };
    writeFileSync(`${this.file}.summary.json`, JSON.stringify(summary, null, 2));
    console.log(`\nlog:     ${this.file}.jsonl\nsummary: ${this.file}.summary.json`);
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }
}

function config(extra = {}) {
  const { turn_detection, ...rest } = extra;
  return {
    type: "realtime",
    model: "higgs-realtime",
    instructions: "You are a job interviewer. Keep every reply to one short sentence.",
    output_modalities: ["audio"],
    audio: {
      input: {
        format: { type: "audio/pcm", rate: RATE },
        transcription: { model: "higgs-stt-3.1" },
        turn_detection: turn_detection ?? { type: "server_vad" },
      },
      output: { format: { type: "audio/pcm", rate: RATE }, voice: "default" },
    },
    ...rest,
  };
}

/** The counts the reports quote. */
function summarize(events) {
  const inn = events.filter((e) => e.dir === "in");
  const responses = {};
  for (const e of inn) {
    const id = e.response?.id ?? e.response_id;
    if (!id) continue;
    const r = (responses[id] ??= { created: 0, done: 0, statuses: [], audio_s: 0, transcript: "", first_t_ms: e.t_ms });
    if (e.type === "response.created") r.created++;
    if (e.type === "response.done") { r.done++; r.statuses.push(e.response?.status); }
    if (e.type === "response.output_audio.delta") r.audio_s += Number(/<(\d+) bytes>/.exec(e.delta)?.[1] ?? 0) / 2 / RATE;
    if (e.type === "response.output_audio_transcript.done") r.transcript = e.transcript;
    if (e.type === "response.output_text.done") r.transcript = e.text;
  }
  for (const r of Object.values(responses)) r.audio_s = Math.round(r.audio_s * 10) / 10;
  const transcripts = {};
  for (const e of inn.filter((x) => x.type === "conversation.item.input_audio_transcription.completed"))
    (transcripts[e.item_id] ??= []).push({ t_ms: e.t_ms, transcript: e.transcript });
  return {
    session_id: inn.find((e) => e.type === "session.created")?.session?.id ?? null,
    responses,
    response_ids_created_more_than_once: Object.entries(responses).filter(([, r]) => r.created > 1).map(([id]) => id),
    response_ids_done_more_than_once: Object.entries(responses).filter(([, r]) => r.done > 1).map(([id]) => id),
    transcription_completed_per_item: transcripts,
    items_with_several_completed: Object.entries(transcripts).filter(([, v]) => v.length > 1).map(([id]) => id),
    errors: inn.filter((e) => e.type === "error").map((e) => ({ t_ms: e.t_ms, at: e.at, event_id: e.event_id, error: e.error })),
  };
}

// --- scenarios -------------------------------------------------------------------------

async function b1() {
  // FEEDBACK_NO_CANCEL=1 runs the same speech without the cancel, as the control.
  const noCancel = process.env.FEEDBACK_NO_CANCEL === "1";
  const s = new Session(noCancel ? "b1-control-no-cancel" : "b1-cancel-before-output");
  await s.open();
  await s.configure();
  let cancelled = null;
  s.on((e) => {
    if (e.type === "response.created" && !cancelled && !noCancel) {
      cancelled = e.response.id;
      s.send({ type: "response.cancel", response_id: cancelled });
    }
  });
  // FEEDBACK_SAY replaces the first utterance (one without a pause isolates the cancel from the resume-merge).
  await s.say(process.env.FEEDBACK_SAY ?? "I think the main risk in production is data drift, so I would monitor the input distribution.");
  await s.next((e) => e.type === "response.created", 15000);
  await sleep(2500);
  await s.say("Sorry, let me add one thing. I would also retrain the model every week.");
  await s.settle();
  return s.close({ cancelled_response_id: cancelled });
}

async function b2() {
  const s = new Session("b2-turn-detection-update");
  await s.open();
  const ask = async (label) => {
    if (s.closed) return { label, answer: null, note: "socket already closed" };
    s.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "What is the code word? Reply with the code word only." }] } });
    s.send({ type: "response.create" });
    const done = await s.next((e) => e.type === "response.done", 20000);
    const r = done && summarize(s.events).responses[done.response.id];
    return { label, response_id: done?.response?.id ?? null, answer: r?.transcript ?? null };
  };
  const word = (w) => `If the user asks for the code word, reply with exactly the single word ${w}.`;
  const first = await s.configure({ instructions: word("APPLE") });
  const a1 = await ask("after update 1 (APPLE)");
  const second = await s.configure({ instructions: word("BANANA"), turn_detection: { type: "server_vad", silence_duration_ms: 250 } });
  await sleep(3000);
  const closedAfterSecond = s.closed;
  const a2 = await ask("after update 2 (BANANA + turn_detection change)");
  const third = await s.configure({ instructions: word("CHERRY") });
  const a3 = await ask("after update 3 (CHERRY, no turn_detection)");
  return s.close({
    update_1_ack: first?.type, update_2_ack: second?.type, update_2_error: second?.error ?? null,
    socket_closed_within_3s_of_update_2: closedAfterSecond, update_3_ack: third?.type, answers: [a1, a2, a3],
  });
}

/**
 * b2c: does a plain instructions change (no turn_detection) apply at all?
 * Session 1 changes the instructions before anything is asked, so no earlier
 * answer can anchor the model. Session 2 asks first, then changes them.
 */
async function b2c() {
  const word = (w) => `If the user asks for the code word, reply with exactly the single word ${w}.`;
  const out = {};
  for (const askFirst of [false, true]) {
    const s = new Session(`b2c-instructions-only-${askFirst ? "after-answer" : "fresh"}`);
    await s.open();
    const ask = async () => {
      s.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "What is the code word? Reply with the code word only." }] } });
      s.send({ type: "response.create" });
      const done = await s.next((e) => e.type === "response.done", 20000);
      return { response_id: done?.response?.id ?? null, answer: (done && summarize(s.events).responses[done.response.id]?.transcript) ?? null };
    };
    const first = await s.configure({ instructions: word("APPLE") });
    const before = askFirst ? await ask() : null;
    const second = await s.configure({ instructions: word("BANANA") });
    await sleep(500);
    const after = await ask();
    out[askFirst ? "after_answer" : "fresh"] = await s.close({ update_1_ack: first?.type, update_2_ack: second?.type, before, after });
  }
  return out;
}

/** b2d: b2 without the rejected update, to separate "rejection breaks later updates" from model anchoring. */
async function b2d() {
  const s = new Session("b2d-two-answers-then-update");
  await s.open();
  const word = (w) => `If the user asks for the code word, reply with exactly the single word ${w}.`;
  const ask = async () => {
    s.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "What is the code word? Reply with the code word only." }] } });
    s.send({ type: "response.create" });
    const done = await s.next((e) => e.type === "response.done", 20000);
    return { response_id: done?.response?.id ?? null, answer: (done && summarize(s.events).responses[done.response.id]?.transcript) ?? null };
  };
  const first = await s.configure({ instructions: word("APPLE") });
  const a1 = await ask();
  const a2 = await ask();
  const second = await s.configure({ instructions: word("CHERRY") });
  await sleep(500);
  const a3 = await ask();
  return s.close({ update_1_ack: first?.type, update_2_ack: second?.type, answers: [a1, a2, a3] });
}

async function b3() {
  const s = new Session("b3-transcription-repeats");
  await s.open();
  await s.configure();
  for (const line of [
    "I'm not sure.",
    "I would start by checking the logs, then I would look at the metrics dashboard.",
    "Precision is the share of predicted positives that are correct.",
  ]) {
    await s.say(line);
    await s.next((e) => e.type === "response.done", 20000);
    await sleep(1500);
  }
  await s.settle(5000);
  return s.close();
}

async function b4() {
  const delay = Number(process.env.FEEDBACK_DELAY_MS ?? 0);
  const s = new Session(`b4-no-user-input-d${delay}`);
  await s.open();
  await s.configure();
  let fired = false;
  s.on((e) => {
    if (e.type === "input_audio_buffer.speech_stopped" && !fired) {
      fired = true;
      setTimeout(() => {
        s.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "Note: ask one follow-up about monitoring." }] } });
        s.send({ type: "response.create" });
      }, delay);
    }
  });
  await s.say("I would deploy the model behind a feature flag and roll it out slowly.");
  await s.settle();
  return s.close({ create_delay_after_speech_stopped_ms: delay });
}

const all = { b1, b2, b2c, b2d, b3, b4 };
const pick = process.argv[2] ?? "all";
const run = pick === "all" ? Object.values(all) : [all[pick]];
if (run.some((f) => !f)) { console.error("usage: node repro/repro.mjs b1|b2|b2c|b2d|b3|b4|all"); process.exit(2); }
for (const f of run) { console.log(`\n=== ${f.name} ===`); await f(); }
process.exit(0);
