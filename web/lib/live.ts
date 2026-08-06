// LiveSession is the client nervous system for the interview room. It abstracts
// three transports behind one event API:
//   - "voice": real Gemini Live over WebSocket — streams mic PCM16 up and plays
//     the interviewer's audio down (barge-in handled by Gemini).
//   - "text":  the backend text-director over WebSocket — the browser listens
//     via SpeechRecognition and speaks the interviewer via SpeechSynthesis.
//   - "local": mock mode — a client-side canned director; browser speech both ways.
// Either way it emits caption/speaking/amplitude/filler/pause events the studio
// UI + avatar + behavioral tracker consume.

import { api, IS_MOCK } from "./api";

export type Caption = { role: "interviewer" | "candidate"; text: string; streaming?: boolean };

// Connection lifecycle the studio surfaces to the candidate. "reconnecting"
// means we dropped and are auto-retrying; "failed" means auto-retry gave up and
// the user should hit Reconnect.
export type ConnState = "connecting" | "connected" | "reconnecting" | "failed" | "closed";

type Events = {
  caption: (c: Caption) => void;
  speaking: (on: boolean) => void; // the INTERVIEWER is speaking (drives avatar)
  userSpeaking: (on: boolean) => void; // the CANDIDATE is speaking (drives speaking-ratio)
  micLevel: (v: number) => void; // 0..1 live mic input level (drives the "listening" meter)
  amplitude: (v: number) => void; // 0..1, drives avatar lip-sync
  mode: (m: "voice" | "text" | "local") => void;
  filler: (word: string) => void;
  pause: (ms: number) => void;
  help: () => void;
  status: (s: string) => void;
  connection: (s: ConnState) => void;
  ended: () => void;
};

const MAX_RECONNECT_ATTEMPTS = 5;

const FILLERS = ["um", "uh", "erm", "ah", "like", "you know", "so yeah", "basically"];
const HELP_PHRASES = ["can you help", "i'm stuck", "give me a hint", "not sure where", "help me"];

export class LiveSession {
  private ws?: WebSocket;
  private handlers: Partial<Events> = {};
  private recog?: SpeechRecognition;
  private mode: "voice" | "text" | "local" = IS_MOCK ? "local" : "text";
  private lastSpeechAt = Date.now();
  private pauseTimer?: number;
  private stopped = false;
  private history: Caption[] = [];
  private lastActivity = Date.now();
  private nudgeTimer?: number;
  private nudged = false;
  private aiSpeaking = false;
  private questionTags: string[];
  private audioCtx?: AudioContext;
  private playHead = 0;
  // Reconnect state.
  private minutes = 30;
  private attempts = 0;
  private reconnectTimer?: number;
  private connState: ConnState = "connecting";
  private candidateIdle?: number; // voice-mode: fires when the candidate pauses

  constructor(private sessionId: string, questionTags: string[] = [], private voiceId: string = "aoede") {
    this.questionTags = questionTags;
  }

  // Map our voice id → a browser SpeechSynthesis voice (by gender heuristic) for
  // the text-director path. Real voice mode uses Gemini's native voice instead.
  private pickVoice(): SpeechSynthesisVoice | null {
    if (!("speechSynthesis" in window)) return null;
    const all = window.speechSynthesis.getVoices();
    if (!all.length) return null;
    const female = ["aoede", "kore", "leda"].includes(this.voiceId);
    const fem = /(female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|zira|susan|allison|ava|jenny|aria)/i;
    const male = /(male|\bman\b|daniel|alex|fred|thomas|oliver|arthur|george|david|mark|guy|ryan)/i;
    const en = all.filter((v) => /^en/i.test(v.lang));
    const pool = en.length ? en : all;
    return pool.find((v) => (female ? fem : male).test(v.name)) ?? pool[0] ?? null;
  }

  on<K extends keyof Events>(ev: K, cb: Events[K]) { this.handlers[ev] = cb; return this; }
  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>) {
    (this.handlers[ev] as ((...a: unknown[]) => void) | undefined)?.(...(args as unknown[]));
  }

  // Reset the silence clock whenever anyone speaks.
  private touch() { this.lastActivity = Date.now(); this.nudged = false; }

  // After ~60s of silence (and the AI isn't talking), nudge ONCE — don't repeat.
  private startNudgeWatch() {
    this.nudgeTimer = window.setInterval(() => {
      if (this.stopped || this.aiSpeaking || this.nudged) return;
      if (Date.now() - this.lastActivity < 60000) return;
      this.nudged = true;
      if (this.mode === "local") { this.localNudge(); return; }
      try { this.ws?.send(JSON.stringify({ type: "nudge" })); } catch { /* ignore */ }
    }, 8000);
  }
  private localNudge() {
    const line = "Take your time — whenever you're ready, walk me through your thinking.";
    this.pushCaption({ role: "interviewer", text: line }); this.speak(line);
  }

  // Tell the interviewer how much time is left (context only — no forced reply).
  sendTime(text: string) { if (this.mode !== "local") { try { this.ws?.send(JSON.stringify({ type: "time", text })); } catch { /* ignore */ } } }

  private setConn(s: ConnState) { this.connState = s; this.emit("connection", s); }
  connectionState() { return this.connState; }

  async start(minutes = 30) {
    this.minutes = minutes;
    this.startNudgeWatch();
    if (IS_MOCK) { this.mode = "local"; this.emit("mode", "local"); this.setConn("connected"); this.beginListening(); this.localGreeting(); return; }
    this.connect();
  }

  private async connect() {
    this.setConn(this.attempts > 0 ? "reconnecting" : "connecting");
    try {
      // Fetch a short-lived ticket so the long-lived JWT never rides in the URL.
      const ticket = await api.wsTicket();
      if (this.stopped) return;
      const url = api.liveUrl(this.sessionId, ticket, this.minutes);
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => this.onWsMessage(e);
      ws.onopen = () => { this.attempts = 0; this.setConn("connected"); this.emit("status", "connected"); };
      ws.onclose = () => { this.emit("status", "disconnected"); this.handleDrop(); };
      ws.onerror = () => { this.emit("status", "connection error"); }; // close fires next → handleDrop
    } catch { this.handleDrop(); }
  }

  // handleDrop schedules an exponential-backoff reconnect after an unexpected
  // close. It's idempotent per drop (a pending timer suppresses duplicates from
  // onerror+onclose firing together).
  private handleDrop() {
    if (this.stopped || this.reconnectTimer) return;
    // Tear down the live audio path; it's rebuilt on the "ready" message.
    this.micStop?.(); this.micStop = undefined;
    if (this.attempts >= MAX_RECONNECT_ATTEMPTS) { this.setConn("failed"); return; }
    this.attempts++;
    const delay = Math.min(8000, 500 * 2 ** (this.attempts - 1));
    this.setConn("reconnecting");
    this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = undefined; this.connect(); }, delay);
  }

  // reconnect is the manual "Reconnect" button: cancel any backoff and retry now.
  reconnect() {
    if (this.stopped) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    this.attempts = 0;
    this.micStop?.(); this.micStop = undefined; // rebuilt on the fresh socket's "ready"
    this.detachWs(); // don't let the old socket's onclose trigger another retry
    this.connect();
  }

  // detachWs silences and closes the current socket so its lifecycle callbacks
  // can't fire into a fresh connection attempt.
  private detachWs() {
    const ws = this.ws;
    if (!ws) return;
    ws.onopen = null; ws.onclose = null; ws.onerror = null; ws.onmessage = null;
    try { ws.close(); } catch { /* ignore */ }
    this.ws = undefined;
  }

  private onWsMessage(e: MessageEvent) {
    if (typeof e.data !== "string") { this.playPcm(new Uint8Array(e.data as ArrayBuffer)); return; }
    let m: { type: string; role?: string; text?: string; mode?: string; streaming?: boolean };
    try { m = JSON.parse(e.data); } catch { return; }
    switch (m.type) {
      case "ready":
        this.mode = (m.mode as "voice" | "text") ?? "text";
        this.emit("mode", this.mode);
        if (this.mode === "voice") this.startMic();
        else this.beginListening();
        break;
      case "say":
        // Text-director full line: display + speak. The server persists the turn.
        this.touch();
        this.emit("caption", { role: "interviewer", text: m.text ?? "", streaming: false });
        if (this.mode !== "voice") this.speak(m.text ?? "");
        break;
      case "transcript": {
        // Voice-mode transcript: full-text-so-far, coalesced client-side.
        this.touch();
        const role = m.role === "candidate" ? "candidate" : "interviewer";
        this.emit("caption", { role, text: m.text ?? "", streaming: !!m.streaming });
        // Candidate speaking → drives "listening"; when they pause, the interviewer
        // is "thinking" (until its audio arrives). Lets the HUD show real state in
        // voice mode (where there's no SpeechRecognition).
        if (role === "candidate") {
          this.emit("userSpeaking", true);
          if (this.candidateIdle) clearTimeout(this.candidateIdle);
          this.candidateIdle = window.setTimeout(() => this.emit("userSpeaking", false), 1500);
        }
        break;
      }
      case "interrupted": this.cancelSpeech(); break;
      case "turn_complete": if (this.candidateIdle) { clearTimeout(this.candidateIdle); this.candidateIdle = undefined; } break;
      case "ended": this.emit("ended"); break;
    }
  }

  // ---- candidate speech in (SpeechRecognition, for text/local modes) ----

  private beginListening() {
    this.startMeter(); // level meter so the candidate sees the mic is live
    if (this.recog) return; // already listening (e.g. after a reconnect)
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition; SpeechRecognition?: new () => SpeechRecognition });
    const Ctor = SR.SpeechRecognition || SR.webkitSpeechRecognition;
    if (!Ctor) { this.emit("status", "speech recognition unavailable — type your answers"); return; }
    const r = new Ctor();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = (ev: SpeechRecognitionEvent) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = res[0].transcript.trim();
        this.noteSpeech();
        if (res.isFinal && text) this.handleCandidate(text);
      }
    };
    // Keep recognition alive: it stops on its own (silence, transient errors) and
    // must be restarted, or the candidate's voice silently stops being captured.
    r.onend = () => { if (!this.stopped) { try { r.start(); } catch { /* already started */ } } };
    // SpeechRecognitionErrorEvent isn't in the TS DOM lib; read `error` via a cast.
    r.onerror = (ev: Event) => {
      const err = (ev as unknown as { error?: string }).error;
      // "aborted"/"no-speech"/"network" are recoverable — onend restarts. Only a
      // hard "not-allowed" (mic denied) is fatal.
      if (err === "not-allowed" || err === "service-not-allowed") {
        this.emit("status", "microphone blocked — type your answers");
      }
    };
    try { r.start(); } catch { /* ignore */ }
    this.recog = r;
    this.watchPauses();
  }

  // startMeter opens a lightweight mic stream + analyser purely to display the
  // live input level (the voice path uses its own stream). Best-effort: if the
  // mic is blocked the interview still works via typing.
  private meterStop?: () => void;
  private async startMeter() {
    if (this.meterStop || this.stopped) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (this.stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 512;
      src.connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      let raf = 0;
      const tick = () => {
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        this.emit("micLevel", Math.min(1, Math.sqrt(sum / data.length) * 4));
        raf = requestAnimationFrame(tick);
      };
      tick();
      this.meterStop = () => { cancelAnimationFrame(raf); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); this.emit("micLevel", 0); };
    } catch { /* mic blocked — no meter, typing still works */ }
  }

  private noteSpeech() {
    const gap = Date.now() - this.lastSpeechAt;
    if (gap > 4000) this.emit("pause", gap);
    this.lastSpeechAt = Date.now();
    this.emit("userSpeaking", true); // real candidate activity, not "AI is silent"
  }

  private watchPauses() {
    this.pauseTimer = window.setInterval(() => {
      const gap = Date.now() - this.lastSpeechAt;
      // ~2s after the candidate's last words, mark them as no longer speaking.
      if (gap > 2000) this.emit("userSpeaking", false);
      if (gap > 8000) { this.emit("pause", gap); this.lastSpeechAt = Date.now(); }
    }, 2000);
  }

  handleCandidate(text: string) {
    this.touch();
    this.pushCaption({ role: "candidate", text });
    const lower = text.toLowerCase();
    FILLERS.forEach((f) => { if (new RegExp(`\\b${f}\\b`).test(lower)) this.emit("filler", f); });
    if (HELP_PHRASES.some((p) => lower.includes(p))) this.emit("help");
    // The server persists candidate turns in WS modes; mock needs no persistence.
    if (this.mode === "local") { this.localRespond(text); return; }
    this.ws?.send(JSON.stringify({ type: "user_text", text }));
  }

  // Allow the UI to submit typed answers too.
  submitText(text: string) { if (text.trim()) this.handleCandidate(text.trim()); }
  sendCanvas(desc: string) {
    if (this.mode === "local") return;
    this.ws?.send(JSON.stringify({ type: "canvas", text: desc }));
  }

  // ---- interviewer speech out (SpeechSynthesis, text/local) ----

  private speak(text: string) {
    if (!("speechSynthesis" in window) || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02; u.pitch = 1.0;
    const v = this.pickVoice();
    if (v) u.voice = v;
    u.onstart = () => { this.aiSpeaking = true; this.touch(); this.emit("speaking", true); this.fakeAmplitude(true); };
    u.onend = () => { this.aiSpeaking = false; this.emit("speaking", false); this.fakeAmplitude(false); };
    window.speechSynthesis.speak(u);
  }
  private cancelSpeech() { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); this.emit("speaking", false); }

  // Approximate mouth movement while the browser TTS speaks (no per-phoneme data).
  private ampTimer?: number;
  private fakeAmplitude(on: boolean) {
    if (this.ampTimer) { clearInterval(this.ampTimer); this.ampTimer = undefined; }
    if (!on) { this.emit("amplitude", 0); return; }
    this.ampTimer = window.setInterval(() => this.emit("amplitude", 0.25 + Math.abs(Math.sin(Date.now() / 90)) * 0.6), 60);
  }

  // ---- real Gemini voice: mic PCM up, audio down ----

  private micStop?: () => void;
  private async startMic() {
    if (this.micStop) return; // mic already streaming (e.g. after a reconnect)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext({ sampleRate: 16000 });
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      src.connect(proc); proc.connect(ctx.destination);
      proc.onaudioprocess = (e) => {
        const f32 = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(f32.length);
        let sum = 0;
        for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; sum += s * s; }
        // Live input level so the UI can prove the mic is being heard.
        this.emit("micLevel", Math.min(1, Math.sqrt(sum / f32.length) * 4));
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm.buffer);
      };
      this.micStop = () => { proc.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); ctx.close(); this.emit("micLevel", 0); };
    } catch { this.emit("status", "microphone blocked — enable mic for voice"); }
  }

  private playPcm(bytes: Uint8Array) {
    if (!this.audioCtx) { this.audioCtx = new AudioContext({ sampleRate: 24000 }); this.playHead = this.audioCtx.currentTime; }
    const ctx = this.audioCtx;
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const f32 = new Float32Array(pcm.length);
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) { f32[i] = pcm[i] / 32768; peak = Math.max(peak, Math.abs(f32[i])); }
    const buf = ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const node = ctx.createBufferSource(); node.buffer = buf; node.connect(ctx.destination);
    const now = ctx.currentTime;
    if (this.playHead < now) this.playHead = now;
    node.start(this.playHead); this.playHead += buf.duration;
    this.aiSpeaking = true; this.touch();
    this.emit("speaking", true); this.emit("amplitude", Math.min(1, peak * 1.4));
    node.onended = () => { if (this.playHead - ctx.currentTime < 0.05) { this.aiSpeaking = false; this.emit("speaking", false); this.emit("amplitude", 0); } };
  }

  // ---- local (mock) canned director ----

  private localGreeting() {
    const line = "Hi, thanks for joining. Let's get started — give me a quick intro, then walk me through how you'd approach this problem.";
    setTimeout(() => { this.pushCaption({ role: "interviewer", text: line }); this.speak(line); }, 600);
  }
  private localRespond(text: string) {
    const lower = text.toLowerCase();
    let line = "Okay. Can you make your back-of-the-envelope numbers concrete — expected QPS, storage per year, and the read/write ratio?";
    if (/(database|postgres|sql|dynamo|store)/.test(lower)) line = "You mentioned a datastore. How would you capture changes out of it for a search index or cache — change data capture, something like Debezium?";
    else if (/cache/.test(lower)) line = "Good. What eviction policy would you use, and how do you handle a cache stampede on a hot key?";
    else if (/(queue|kafka|stream)/.test(lower)) line = "How do you guarantee ordering and exactly-once semantics through that queue?";
    else if (/(shard|partition|scale)/.test(lower)) line = "How do you pick the shard key, and what happens with a hot partition?";
    setTimeout(() => { this.pushCaption({ role: "interviewer", text: line }); this.speak(line); }, 700);
  }

  private pushCaption(c: Caption) {
    this.history.push(c);
    this.emit("caption", c);
  }

  end() {
    this.stopped = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    if (this.candidateIdle) { clearTimeout(this.candidateIdle); this.candidateIdle = undefined; }
    try { this.recog?.stop(); } catch { /* ignore */ }
    if (this.pauseTimer) clearInterval(this.pauseTimer);
    if (this.nudgeTimer) clearInterval(this.nudgeTimer);
    if (this.ampTimer) clearInterval(this.ampTimer);
    this.micStop?.();
    this.meterStop?.(); this.meterStop = undefined;
    this.audioCtx?.close().catch(() => {}); this.audioCtx = undefined; // free the playback context
    this.cancelSpeech();
    try { this.ws?.send(JSON.stringify({ type: "end" })); } catch { /* ignore */ }
    this.ws?.close();
    this.setConn("closed");
  }
}
