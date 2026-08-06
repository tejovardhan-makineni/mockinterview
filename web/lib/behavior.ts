// BehaviorTracker samples the candidate's webcam in-browser (zero server cost)
// and batches normalized signals to the backend. It always works via a
// canvas-luminance analysis (lighting, framing, presence). If MediaPipe's face
// landmarker loads, it refines gaze/eye-contact + blink; otherwise it degrades
// gracefully. Discrete events (filler words, long pauses, help requests) are fed
// in from the LiveSession.

import { api } from "./api";

type Sample = {
  ts_ms: number;
  gaze: { on_screen: number };
  lighting: { score: number };
  framing: { score: number };
  posture: { score: number };
  vad: { speaking: number };
};
type Event = { ts_ms: number; kind: string; data?: Record<string, unknown> };

export class BehaviorTracker {
  private canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  private samples: Sample[] = [];
  private events: Event[] = [];
  private timer?: number;
  private flushTimer?: number;
  private start = Date.now();
  private centers: number[] = [];
  private speaking = 0;
  // MediaPipe (optional)
  private landmarker: unknown = null;

  constructor(private sessionId: string, private video: HTMLVideoElement) {}

  async begin() {
    this.canvas!.width = 160; this.canvas!.height = 120;
    void this.tryLoadMediapipe();
    this.timer = window.setInterval(() => this.sample(), 2000);
    this.flushTimer = window.setInterval(() => this.flush(), 10000);
  }

  setSpeaking(on: boolean) { this.speaking = on ? 1 : 0; }
  addEvent(kind: string, data?: Record<string, unknown>) {
    this.events.push({ ts_ms: Date.now() - this.start, kind, data });
  }

  private async tryLoadMediapipe() {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
      );
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
    } catch { this.landmarker = null; /* canvas fallback still runs */ }
  }

  private sample() {
    const v = this.video;
    if (!v || v.readyState < 2 || !this.canvas) return;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.drawImage(v, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;

    // Luminance stats overall + center region.
    let sum = 0, centerSum = 0, centerN = 0, edgeSum = 0, edgeN = 0;
    let cxAccum = 0, cyAccum = 0, brightN = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        sum += lum;
        const inCenter = x > W * 0.3 && x < W * 0.7 && y > H * 0.2 && y < H * 0.7;
        if (inCenter) { centerSum += lum; centerN++; } else { edgeSum += lum; edgeN++; }
        if (lum > 90) { cxAccum += x; cyAccum += y; brightN++; }
      }
    }
    const mean = sum / (W * H);
    const centerMean = centerN ? centerSum / centerN : mean;
    const edgeMean = edgeN ? edgeSum / edgeN : mean;

    // Lighting: best around mid-bright, penalize too dark / blown out.
    const lightingScore = clamp01(1 - Math.abs(mean - 125) / 125) * 4;

    // Framing: subject (center) should be brighter/more present than edges, and
    // the bright centroid near the frame center.
    const cx = brightN ? cxAccum / brightN / W : 0.5;
    const cy = brightN ? cyAccum / brightN / H : 0.5;
    const centerOffset = Math.hypot(cx - 0.5, cy - 0.42);
    const subjectContrast = clamp01((centerMean - edgeMean) / 40 + 0.5);
    const framingScore = clamp01((1 - centerOffset * 1.6) * 0.6 + subjectContrast * 0.4) * 4;

    // Presence / posture stability from centroid jitter.
    this.centers.push(cx); if (this.centers.length > 10) this.centers.shift();
    const jitter = variance(this.centers);
    const postureScore = clamp01(1 - jitter * 40) * 4;
    const present = brightN > W * H * 0.05 ? 1 : 0;

    // Gaze / eye-contact: refined by MediaPipe if available, else presence-based.
    let onScreen = present ? 0.75 : 0;
    onScreen = this.refineGaze(onScreen);

    this.samples.push({
      ts_ms: Date.now() - this.start,
      gaze: { on_screen: round2(onScreen) },
      lighting: { score: round2(lightingScore) },
      framing: { score: round2(framingScore) },
      posture: { score: round2(postureScore) },
      vad: { speaking: this.speaking },
    });
  }

  private refineGaze(fallback: number): number {
    const lm = this.landmarker as { detectForVideo?: (v: HTMLVideoElement, t: number) => { facialTransformationMatrixes?: { data: number[] }[] } } | null;
    if (!lm?.detectForVideo) return fallback;
    try {
      const res = lm.detectForVideo(this.video, performance.now());
      const mat = res.facialTransformationMatrixes?.[0]?.data;
      if (!mat) return fallback * 0.9; // face not found → likely looking away
      // Yaw/pitch from the rotation matrix; small angles ⇒ facing screen.
      const yaw = Math.atan2(mat[8], mat[10]);
      const pitch = Math.atan2(-mat[9], Math.hypot(mat[8], mat[10]));
      const facing = clamp01(1 - (Math.abs(yaw) + Math.abs(pitch)) / 1.0);
      return facing;
    } catch { return fallback; }
  }

  private async flush() {
    if (!this.samples.length && !this.events.length) return;
    const payload = { samples: this.samples, events: this.events };
    this.samples = []; this.events = [];
    try { await api.ingestBehavior(this.sessionId, payload); } catch { /* best effort */ }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
  }
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function round2(x: number) { return Math.round(x * 100) / 100; }
function variance(a: number[]) {
  if (a.length < 2) return 0;
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length;
}
