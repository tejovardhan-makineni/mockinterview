import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authHttp } from "./features/auth";
import { resumeHttp } from "./features/resume";
import { localDestination, policyDestination } from "./policyNavigation";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("policy and data controls", () => {
  it("does not invent an adult declaration for an old API caller", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{"detail":"policies required"}', { status: 400 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      authHttp.register("adult@example.test", "synthetic-password"),
    ).rejects.toMatchObject({ status: 400 });
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent).not.toHaveProperty("adult_confirmed");
    expect(localStorage.getItem("mi_token")).toBeNull();
  });
  it("records only the explicit versions supplied after review and preserves the existing login", async () => {
    localStorage.setItem("mi_token", "existing-token");
    const acceptance = {
      adult_confirmed: true,
      terms_version: "current-terms",
      privacy_version: "current-privacy",
    };
    const user = {
      id: "synthetic",
      email: "adult@example.test",
      ...acceptance,
      policies_required: false,
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(user)));
    vi.stubGlobal("fetch", fetch);
    expect(await authHttp.acceptPolicies(acceptance)).toEqual(user);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(acceptance);
    expect(localStorage.getItem("mi_token")).toBe("existing-token");
    expect(JSON.parse(localStorage.getItem("mi_user")!)).toEqual(user);
  });
  it("clears all prior resume caches only after the server confirms deletion, keeping sign-in and workspace", async () => {
    localStorage.setItem("mi_token", "existing-token");
    localStorage.setItem("mi_resume_review_old", "private");
    localStorage.setItem("mi_resume_match_new", "private");
    sessionStorage.setItem("mi_workspace_saved", "interview");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"detail":"unavailable"}', { status: 503 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(resumeHttp.deleteResumes()).rejects.toMatchObject({
      status: 503,
    });
    expect(localStorage.getItem("mi_resume_review_old")).toBe("private");
    await resumeHttp.deleteResumes();
    expect(localStorage.getItem("mi_resume_review_old")).toBeNull();
    expect(localStorage.getItem("mi_resume_match_new")).toBeNull();
    expect(localStorage.getItem("mi_token")).toBe("existing-token");
    expect(sessionStorage.getItem("mi_workspace_saved")).toBe("interview");
  });
  it("keeps policy return links on this app", () => {
    for (const next of [
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "/\n/example.com",
    ])
      expect(localDestination(next)).toBe("/interviews");
    expect(policyDestination("/setup?q=one&round=two")).toBe(
      "/consent?next=%2Fsetup%3Fq%3Done%26round%3Dtwo",
    );
  });
});
