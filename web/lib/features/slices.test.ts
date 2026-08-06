import { describe, it, expect, beforeEach } from "vitest";
import { authMock } from "./auth";
import { resumeMock } from "./resume";
import { profileMock, DEFAULT_CONFIG } from "./profile";
import { interviewMock } from "./interview";

// These exercise the mock feature slices in isolation — each owns its own
// localStorage keys, so improving one slice can't silently break another.
beforeEach(() => window.localStorage.clear());

describe("auth slice (mock)", () => {
  it("registers and then resolves the current user", async () => {
    const r = await authMock.register("a@b.com", "pw");
    expect(r.user.email).toBe("a@b.com");
    expect(await authMock.me()).toEqual(r.user);
  });
  it("clears the user on logout", async () => {
    await authMock.login("a@b.com", "pw");
    authMock.logout();
    expect(await authMock.me()).toBeNull();
  });
});

describe("resume slice (mock)", () => {
  it("persists an uploaded resume and reads it back", async () => {
    expect(await resumeMock.getResume()).toBeNull();
    const up = await resumeMock.uploadResume(new File(["x"], "cv.pdf"));
    expect(up.filename).toBe("cv.pdf");
    expect((await resumeMock.getResume())?.filename).toBe("cv.pdf");
  });
  it("returns a structured review", async () => {
    const rev = await resumeMock.reviewResume();
    expect(rev.line_edits.length).toBeGreaterThan(0);
    expect(rev.overall_score).toBeGreaterThan(0);
  });
});

describe("profile slice (mock)", () => {
  it("defaults config then persists changes", async () => {
    expect(await profileMock.getConfig()).toEqual(DEFAULT_CONFIG);
    await profileMock.saveConfig({ ...DEFAULT_CONFIG, intensity: 5 });
    expect((await profileMock.getConfig()).intensity).toBe(5);
  });
  it("round-trips the profile", async () => {
    await profileMock.saveProfile({ domain: "medicine" });
    expect((await profileMock.getProfile()).domain).toBe("medicine");
  });
});

describe("interview slice (mock)", () => {
  it("creates a session and lists a completed one", async () => {
    const sess = await interviewMock.createSession("url-shortener", DEFAULT_CONFIG);
    expect(sess.question_id).toBe("url-shortener");
    const list = await interviewMock.listSessions();
    expect(list.length).toBeGreaterThan(0);
  });
  it("returns a report with scored dimensions", async () => {
    const rep = await interviewMock.getReport("s1");
    expect(rep.session_id).toBe("s1");
    expect(rep.scores.length).toBeGreaterThan(0);
  });
  it("has no live URL in mock mode", () => {
    expect(interviewMock.liveUrl("s1", "t", 30)).toBe("");
  });
});
