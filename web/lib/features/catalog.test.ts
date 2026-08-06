import { describe, it, expect } from "vitest";
import { matchScore, MOCK_QUESTIONS, catalogMock } from "./catalog";
import type { QuestionSummary } from "./catalog";

const q: QuestionSummary = {
  id: "url-shortener", title: "Design a URL Shortener (TinyURL)", track: "engineering",
  domain: "system_design", modality: "system_design", difficulty: "mid",
  tags: ["hashing", "kv-store", "caching"],
  prompt: "Design a service that turns long URLs into short links.",
  blurb: "Read-heavy KV design — hashing, collisions, cache, analytics.",
};

describe("matchScore", () => {
  it("returns 1 for an empty query (show all)", () => {
    expect(matchScore(q, "")).toBe(1);
    expect(matchScore(q, "   ")).toBe(1);
  });

  it("scores a full substring hit highest", () => {
    expect(matchScore(q, "url shortener")).toBe(3);
    expect(matchScore(q, "caching")).toBe(3); // tag substring
  });

  it("scores partial token overlap between 0 and 1", () => {
    const s = matchScore(q, "hashing collisions");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("returns 0 for a fully unrelated query", () => {
    expect(matchScore(q, "zzzzz qqqqq")).toBe(0);
  });

  it("rewards a 4+ char prefix as a partial match", () => {
    // "colli" shares a 4-char prefix with "collisions" in the blurb.
    expect(matchScore(q, "colli")).toBeGreaterThan(0);
  });
});

describe("catalogMock", () => {
  it("lists the mock questions", async () => {
    expect(await catalogMock.listQuestions()).toEqual(MOCK_QUESTIONS);
  });
  it("falls back to the first question for an unknown id", async () => {
    expect((await catalogMock.getQuestion("nope")).id).toBe(MOCK_QUESTIONS[0].id);
  });
});
