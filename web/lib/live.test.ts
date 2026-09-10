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
}[] = [];
class Audio {
  currentTime = 0;
  state = "running";
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
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
      onended: null,
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
});
