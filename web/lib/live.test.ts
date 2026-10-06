import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({
  IS_MOCK: false,
  api: {
    wsTicket: vi.fn(async () => "ticket"),
    liveUrl: () => "ws://localhost/live",
  },
}));
import { LiveSession } from "./live";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  binaryType = "";
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });
  constructor() {
    Socket.instances.push(this);
  }
  message(value: object) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
const sources: {
  stop: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}[] = [];
class Audio {
  static instances: Audio[] = [];
  static initialState = "running";
  static allowResume = true;
  currentTime = 0;
  state = Audio.initialState;
  onstatechange: (() => void) | null = null;
  destination = {};
  resume = vi.fn(async () => {
    if (Audio.allowResume) {
      this.state = "running";
      this.onstatechange?.();
    }
  });
  close = vi.fn(async () => {});
  processor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null as
      | ((event: {
          inputBuffer: { getChannelData: () => Float32Array };
        }) => void)
      | null,
  };
  constructor() {
    Audio.instances.push(this);
  }
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createScriptProcessor() {
    return this.processor;
  }
  createAnalyser() {
    return { fftSize: 512, connect: vi.fn(), getFloatTimeDomainData: vi.fn() };
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, copyToChannel: vi.fn() };
  }
  createBufferSource() {
    const source = {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      onended: null as (() => void) | null,
    };
    sources.push(source);
    return source;
  }
}
let live: LiveSession;
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  sources.length = 0;
  Audio.instances = [];
  Audio.initialState = "running";
  Audio.allowResume = true;
  sessionStorage.clear();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("AudioContext", Audio);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
});

describe("truthful room device health", () => {
  function microphone() {
    const track = Object.assign(new EventTarget(), {
      readyState: "live",
      muted: false,
      stop: vi.fn(),
    });
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);
    return track;
  }

  it("initializes sound automatically and asks for recovery only while playback is suspended", async () => {
    Audio.initialState = "suspended";
    Audio.allowResume = false;
    await start("voice");
    expect(live.playbackState()).toBe("blocked");
    expect(Audio.instances).toHaveLength(1);
    Audio.allowResume = true;
    document.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(live.playbackState()).toBe("ready");
    const context = Audio.instances[0];
    context.state = "suspended";
    context.onstatechange?.();
    expect(live.playbackState()).toBe("blocked");
    live.end();
    const resumes = context.resume.mock.calls.length;
    document.dispatchEvent(new Event("keydown"));
    expect(context.resume).toHaveBeenCalledTimes(resumes);
  });

  it("reports capture, real input, muted input, and disconnected devices separately", async () => {
    const track = microphone();
    const socket = await start("voice");
    const level = vi.fn();
    live.on("micLevel", level);
    socket.message({ type: "ready", mode: "voice" });
    expect(live.microphoneState()).toBe("starting");
    await Promise.resolve();
    expect(live.microphoneState()).toBe("live");
    const capture = Audio.instances[1];
    capture.processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array([0.1, -0.1]) },
    });
    expect(level).toHaveBeenLastCalledWith(expect.closeTo(0.4));
    track.muted = true;
    track.dispatchEvent(new Event("mute"));
    expect(live.microphoneState()).toBe("interrupted");
    expect(level).toHaveBeenLastCalledWith(0);
    track.muted = false;
    track.dispatchEvent(new Event("unmute"));
    expect(live.microphoneState()).toBe("live");
    track.readyState = "ended";
    track.dispatchEvent(new Event("ended"));
    expect(live.microphoneState()).toBe("unavailable");
    expect(capture.close).toHaveBeenCalledOnce();
    live.setMuted(true);
    expect(live.microphoneState()).toBe("muted");
  });

  it("clears stale microphone health when the connection drops", async () => {
    const track = microphone();
    const socket = await start("voice");
    socket.message({ type: "ready", mode: "voice" });
    await Promise.resolve();
    expect(live.microphoneState()).toBe("live");
    socket.close();
    expect(live.microphoneState()).toBe("off");
    expect(track.stop).toHaveBeenCalledOnce();
    expect(live.connectionState()).toBe("reconnecting");
  });

  it("recovers a suspended microphone without interrupting healthy speaker playback", async () => {
    microphone();
    const socket = await start("voice");
    socket.message({ type: "ready", mode: "voice" });
    await Promise.resolve();
    const capture = Audio.instances[1];
    capture.state = "suspended";
    capture.onstatechange?.();
    capture.resume.mockRejectedValueOnce(
      new Error("Capture still interrupted"),
    );
    await live.enableAudio();
    expect(live.microphoneState()).toBe("interrupted");
    expect(live.playbackState()).toBe("ready");
    await live.enableAudio();
    expect(live.microphoneState()).toBe("live");
    expect(Audio.instances).toHaveLength(2);
  });

  it("preserves a microphone mute chosen while connecting", async () => {
    const socket = await start("voice");
    live.setMuted(true);
    socket.message({ type: "ready", mode: "voice" });
    expect(live.microphoneState()).toBe("muted");
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("surfaces denied microphone permission without claiming that it is live", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    const socket = await start("voice");
    socket.message({ type: "ready", mode: "voice" });
    await Promise.resolve();
    expect(live.microphoneState()).toBe("unavailable");
    live.submitText("I can continue by typing.");
    expect(sentMessages("user_text")).toHaveLength(1);
  });

  it("does not initialize voice hardware or an audio prompt for text interviews", async () => {
    const socket = await start("text");
    socket.message({ type: "ready", mode: "text" });
    document.dispatchEvent(new Event("pointerdown"));
    expect(live.microphoneState()).toBe("off");
    expect(live.playbackState()).toBe("idle");
    expect(Audio.instances).toHaveLength(0);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
});
afterEach(() => {
  live?.end();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function start(mode: "voice" | "text" = "text") {
  live = new LiveSession("test-session", [], "aoede", { mode });
  await live.start();
  await Promise.resolve();
  return Socket.instances[0];
}
describe("live transport lifecycle", () => {
  it("waits for provider ready and acknowledges typed answers only after persistence", async () => {
    const socket = await start();
    socket.onopen?.();
    expect(live.connectionState()).toBe("connecting");
    live.submitText("My answer");
    expect(socket.send).not.toHaveBeenCalled();
    socket.message({ type: "ready", mode: "text" });
    expect(live.connectionState()).toBe("connected");
    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.text).toBe("My answer");
    expect(sent.event_id).toBeTruthy();
    expect(live.pendingAnswers()).toBe(1);
    socket.message({ type: "ack", event_id: sent.event_id });
    await live.drain();
    expect(live.pendingAnswers()).toBe(0);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
  it("uses the server's text fallback without microphone capture or unexpected speech", async () => {
    const socket = await start("voice");
    const mode = vi.fn();
    live.on("mode", mode);
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", {
      speak,
      cancel: vi.fn(),
      getVoices: () => [],
    });
    socket.message({ type: "ready", mode: "text" });
    socket.message({ type: "say", text: "Type your answer" });
    expect(mode).toHaveBeenCalledWith("text");
    expect(live.isMuted()).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });
  it("stops every queued PCM source on interruption", async () => {
    const socket = await start("voice");
    socket.onmessage?.({ data: new Int16Array([100, 200, 300]).buffer });
    socket.onmessage?.({ data: new Int16Array([400, 500, 600]).buffer });
    expect(sources).toHaveLength(2);
    socket.message({ type: "interrupted" });
    for (const source of sources) {
      expect(source.stop).toHaveBeenCalledOnce();
      expect(source.disconnect).toHaveBeenCalledOnce();
    }
  });
  it("stops a microphone granted after the room ended", async () => {
    let grant!: (stream: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const socket = await start("voice");
    socket.message({ type: "ready", mode: "voice" });
    live.end();
    const stop = vi.fn();
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
  it("surfaces terminal provider errors without an automatic reconnect loop", async () => {
    const socket = await start();
    const error = vi.fn();
    live.on("error", error);
    socket.message({
      type: "error",
      code: "invalid_key",
      text: "Model key rejected",
      retryable: false,
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(error).toHaveBeenCalledWith("Model key rejected");
    expect(live.connectionState()).toBe("failed");
    expect(Socket.instances).toHaveLength(1);
  });
  it("bounds retries when sockets open but the provider never becomes ready", async () => {
    await start();
    for (let i = 0; i < 6; i++) {
      const socket = Socket.instances.at(-1)!;
      socket.onopen?.();
      socket.onclose?.();
      await vi.advanceTimersByTimeAsync(8100);
    }
    expect(live.connectionState()).toBe("failed");
    expect(Socket.instances).toHaveLength(6);
  });
  it("does not send control messages after the socket starts closing", async () => {
    const socket = await start();
    socket.message({ type: "ready", mode: "text" });
    socket.send.mockClear();
    socket.readyState = 2;
    live.sendTime("One minute remaining");
    live.end();
    expect(socket.send).not.toHaveBeenCalled();
  });
});

function sentMessages(type: string) {
  return Socket.instances.flatMap((socket) =>
    socket.send.mock.calls
      .filter(([data]) => typeof data === "string")
      .map(([data]) => JSON.parse(data))
      .filter((message) => message.type === type),
  );
}

describe("silence nudge budget", () => {
  it("waits for interview readiness without consuming the nudge during connection", async () => {
    const socket = await start();
    await vi.advanceTimersByTimeAsync(128000);
    expect(sentMessages("nudge")).toHaveLength(0);
    socket.message({ type: "ready", mode: "text" });
    await vi.advanceTimersByTimeAsync(64000);
    expect(sentMessages("nudge")).toHaveLength(1);
  });

  it("refreshes idle timing for interviewer speech without letting a nudge rearm itself", async () => {
    const socket = await start("voice");
    live.setMuted(true);
    socket.message({ type: "ready", mode: "voice" });
    await vi.advanceTimersByTimeAsync(56000);
    socket.message({
      type: "transcript",
      role: "interviewer",
      text: "How would you approach this?",
    });
    await vi.advanceTimersByTimeAsync(56000);
    expect(sentMessages("nudge")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(8000);
    expect(sentMessages("nudge")).toHaveLength(1);

    socket.onmessage?.({ data: new Int16Array([100, 200, 300]).buffer });
    socket.message({
      type: "transcript",
      role: "interviewer",
      text: "Take your time — whenever you're ready.",
    });
    sources[0].onended?.();
    socket.message({ type: "turn_complete" });
    await vi.advanceTimersByTimeAsync(128000);
    expect(sentMessages("nudge")).toHaveLength(1);

    socket.message({ type: "say", text: "I am still listening." });
    socket.message({ type: "interrupted" });
    await vi.advanceTimersByTimeAsync(128000);
    expect(sentMessages("nudge")).toHaveLength(1);
  });

  it("rearms only for nonempty candidate speech or a typed answer", async () => {
    const socket = await start("voice");
    live.setMuted(true);
    socket.message({ type: "ready", mode: "voice" });
    await vi.advanceTimersByTimeAsync(64000);
    expect(sentMessages("nudge")).toHaveLength(1);

    socket.message({ type: "transcript", role: "candidate", text: "  " });
    live.submitText(" ");
    await vi.advanceTimersByTimeAsync(64000);
    expect(sentMessages("nudge")).toHaveLength(1);
    expect(sentMessages("user_text")).toHaveLength(0);

    socket.message({
      type: "transcript",
      role: "candidate",
      text: "I would start by clarifying the requirements.",
      streaming: true,
    });
    await vi.advanceTimersByTimeAsync(64000);
    expect(sentMessages("nudge")).toHaveLength(2);

    live.submitText("My next step is to estimate the traffic.");
    expect(sentMessages("user_text")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(64000);
    expect(sentMessages("nudge")).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(128000);
    expect(sentMessages("nudge")).toHaveLength(3);
  });

  it("preserves the spent budget across reconnect and pending-answer replay", async () => {
    const socket = await start();
    socket.message({ type: "ready", mode: "text" });
    live.submitText("My saved answer");
    await vi.advanceTimersByTimeAsync(64000);
    expect(sentMessages("nudge")).toHaveLength(1);

    socket.close();
    await vi.advanceTimersByTimeAsync(500);
    const resumed = Socket.instances.at(-1)!;
    expect(resumed).not.toBe(socket);
    resumed.message({ type: "ready", mode: "text" });
    const answers = sentMessages("user_text");
    expect(answers).toHaveLength(2);
    expect(answers[1].event_id).toBe(answers[0].event_id);
    resumed.message({ type: "ack", event_id: answers[1].event_id });
    await vi.advanceTimersByTimeAsync(128000);
    expect(live.pendingAnswers()).toBe(0);
    expect(sentMessages("nudge")).toHaveLength(1);
  });
});

describe("workspace observation and candidate thinking time", () => {
  it("flushes current work before speech onset and again after a pause without sending every audio block", async () => {
    const track = Object.assign(new EventTarget(), {
      readyState: "live",
      muted: false,
      stop: vi.fn(),
    });
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream);
    const socket = await start("voice");
    socket.message({ type: "ready", mode: "voice" });
    await Promise.resolve();
    const capture = Audio.instances[1];
    const audioBlock = (level: number, length = 2048) =>
      capture.processor.onaudioprocess?.({
        inputBuffer: {
          getChannelData: () => new Float32Array(length).fill(level),
        },
      });
    live.sendCanvas("code just edited");
    audioBlock(0);
    expect(sentMessages("canvas")).toHaveLength(0);
    socket.send.mockClear();
    audioBlock(0.03);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
      type: "canvas",
      text: "code just edited",
    });
    expect(socket.send.mock.calls[1][0]).toBeInstanceOf(ArrayBuffer);
    live.sendCanvas("code edited while speaking");
    audioBlock(0.03);
    expect(sentMessages("canvas")).toHaveLength(1);
    audioBlock(0, 6400);
    audioBlock(0.03);
    expect(sentMessages("canvas").at(-1)?.text).toBe(
      "code edited while speaking",
    );
    audioBlock(0, 6400);
    audioBlock(0.03);
    expect(sentMessages("canvas")).toHaveLength(2);
  });

  it("sends only changed snapshots every five seconds, including erased work", async () => {
    const socket = await start();
    socket.message({ type: "ready", mode: "text" });
    live.sendCanvas("Kafka → Flink");
    await vi.advanceTimersByTimeAsync(4999);
    expect(sentMessages("canvas")).toHaveLength(0);
    live.sendCanvas("Kafka → Flink → OLAP");
    await vi.advanceTimersByTimeAsync(1);
    expect(sentMessages("canvas")).toEqual([
      { type: "canvas", text: "Kafka → Flink → OLAP" },
    ]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(sentMessages("canvas")).toHaveLength(1);
    live.sendCanvas("");
    await vi.advanceTimersByTimeAsync(5000);
    expect(sentMessages("canvas").at(-1)?.text).toBe("");
  });

  it("protects active drawing and waits one minute after the last technical edit", async () => {
    live = new LiveSession("design", [], "aoede", {
      mode: "text",
      modality: "system_design",
    });
    await live.start();
    await Promise.resolve();
    Socket.instances[0].message({ type: "ready", mode: "text" });
    for (let i = 0; i < 36; i++) {
      live.noteWorkspaceActivity();
      live.sendCanvas(`design revision ${i}`);
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(sentMessages("nudge")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(50000);
    expect(sentMessages("nudge")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(13000);
    expect(sentMessages("nudge")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(240000);
    expect(sentMessages("nudge")).toHaveLength(1);
  });

  it("throttles activity signals and sends the latest code before a submitted answer", async () => {
    const socket = await start();
    socket.message({ type: "ready", mode: "text" });
    for (let i = 0; i < 20; i++) live.noteWorkspaceActivity();
    expect(sentMessages("workspace_activity")).toHaveLength(1);
    live.sendCanvas("return result;");
    live.submitText("I have finished implementing it.");
    const messages = socket.send.mock.calls.map(([data]) => JSON.parse(data));
    expect(sentMessages("canvas")).toHaveLength(1);
    expect(messages.findIndex((m) => m.type === "canvas")).toBeLessThan(
      messages.findIndex((m) => m.type === "user_text"),
    );
    socket.close();
    await vi.advanceTimersByTimeAsync(500);
    Socket.instances.at(-1)!.message({ type: "ready", mode: "text" });
    expect(sentMessages("canvas")).toHaveLength(2);
  });
});

describe("server and browser idle coordination", () => {
  it("keeps restored empty notes from extending conversational thinking time", async () => {
    live = new LiveSession("conversation", [], "aoede", {
      mode: "text",
      modality: "conversational",
    });
    live.sendCanvas("");
    await live.start();
    await Promise.resolve();
    Socket.instances[0].message({ type: "ready", mode: "text" });
    await vi.advanceTimersByTimeAsync(48000);
    expect(sentMessages("nudge")).toHaveLength(1);
  });

  it("retries a check-in deferred by newer server activity without repeating accepted nudges", async () => {
    const socket = await start();
    socket.message({ type: "ready", mode: "text" });
    await vi.advanceTimersByTimeAsync(64000);
    expect(sentMessages("nudge")).toHaveLength(1);
    socket.message({ type: "nudge_deferred" });
    await vi.advanceTimersByTimeAsync(64000);
    expect(sentMessages("nudge")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(128000);
    expect(sentMessages("nudge")).toHaveLength(2);
  });

  it("extends thinking time during notes but restores conversation pacing after a submitted answer", async () => {
    live = new LiveSession("notes", [], "aoede", {
      mode: "text",
      modality: "conversational",
    });
    await live.start();
    await Promise.resolve();
    Socket.instances[0].message({ type: "ready", mode: "text" });
    live.noteWorkspaceActivity();
    await vi.advanceTimersByTimeAsync(48000);
    expect(sentMessages("nudge")).toHaveLength(0);
    live.submitText("Here is my completed answer.");
    await vi.advanceTimersByTimeAsync(48000);
    expect(sentMessages("nudge")).toHaveLength(1);
  });
});
