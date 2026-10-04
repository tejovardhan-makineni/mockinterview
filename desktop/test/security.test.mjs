import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedExternal,
  sameAppOrigin,
  bridgeHeaders,
  parseReady,
  childEnvironment,
  validatePreferences,
  contentSecurityPolicy,
} from "../src/security.mjs";

test("community links allow only exact HTTPS owners, with no protocol or host spoofing", () => {
  for (const url of [
    "https://github.com/tejovardhan-makineni/mockinterview",
    "https://github.com/tejovardhan-makineni/mockinterview/releases",
    "https://discord.gg/KvGunFKZwS",
    "https://www.reddit.com/r/mockinterview_live/",
    "https://x.com/mockinterviewlv?s=11",
    "https://x.com/mockinterviewlv/status/123",
    "https://mockinterview.live/docs/",
  ])
    assert.equal(isAllowedExternal(url), true, url);
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://github.com/other/repo",
    "https://github.com/tejovardhan-makineni/mockinterview-evil",
    "https://github.com.evil.test/tejovardhan-makineni/mockinterview",
    "https://user@github.com/tejovardhan-makineni/mockinterview",
    "https://discord.gg/other",
    "https://x.com/other-account",
    "https://x.com/mockinterviewlv-evil",
    "https://x.com.evil.test/mockinterviewlv?s=11",
    "https://mockinterview.live:8443",
  ])
    assert.equal(isAllowedExternal(url), false, url);
});

test("provider billing and legal documents are narrowly allowed", () => {
  assert.equal(isAllowedExternal("mailto:makinenitejovardhan@gmail.com"), true);
  assert.equal(isAllowedExternal("mailto:other@example.com"), false);
  assert.equal(
    isAllowedExternal("mailto:makinenitejovardhan@gmail.com?body=secret"),
    false,
  );
  assert.equal(
    isAllowedExternal("https://ai.google.dev/gemini-api/docs/billing"),
    true,
  );
  assert.equal(isAllowedExternal("https://openai.com/business-data/"), true);
  assert.equal(isAllowedExternal("https://ai.google.dev/arbitrary"), false);
  assert.equal(
    isAllowedExternal(
      "https://ai.google.dev.evil.test/gemini-api/docs/billing",
    ),
    false,
  );
  assert.equal(
    isAllowedExternal("https://openai.com/business-data/other"),
    false,
  );
});

test("bridge token is inserted for exact HTTP and WebSocket origins and stripped everywhere else", () => {
  const origin = "http://127.0.0.1:38101";
  const headers = { "x-desktop-token": "attacker", Accept: "application/json" };
  for (const url of [
    `${origin}/api/v1/sessions`,
    "ws://127.0.0.1:38101/api/v1/live",
  ])
    assert.deepEqual(bridgeHeaders(headers, url, origin, "secret"), {
      Accept: "application/json",
      "X-Desktop-Token": "secret",
    });
  for (const url of [
    "https://example.com",
    "http://127.0.0.1:38102",
    "http://localhost:38101",
    "http://user@127.0.0.1:38101",
  ])
    assert.deepEqual(bridgeHeaders(headers, url, origin, "secret"), {
      Accept: "application/json",
    });
  assert.equal(sameAppOrigin("file:///tmp/app", origin), false);
});

test("ready event accepts only a loopback random-port base URL", () => {
  assert.equal(
    parseReady('{"msg":"desktop_ready","url":"http://127.0.0.1:12345"}'),
    "http://127.0.0.1:12345",
  );
  for (const url of [
    "https://example.com",
    "http://0.0.0.0:12345",
    "http://localhost:12345",
    "http://127.0.0.1:12345/api",
    "http://127.0.0.1:12345?key=secret",
  ])
    assert.equal(
      parseReady(JSON.stringify({ msg: "desktop_ready", url })),
      null,
    );
  assert.equal(parseReady("arbitrary stderr text"), null);
});

test("child environment excludes inherited hosted credentials, proxies and development overrides", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/private/user",
    GEMINI_API_KEY: "hosted",
    DATABASE_URL: "production",
    JWT_SECRET: "inherited",
    HTTP_PROXY: "attacker",
    NODE_OPTIONS: "unsafe",
    LOCAL_UNLIMITED: "true",
    USE_STUB_LLM: "true",
  };
  const config = {
    database: "/data/local.sqlite",
    web: "/app/web",
    bridgeToken: "bridge",
    jwtSecret: "new",
    encryptionKey: "key",
    corpus: "/app/corpus",
    packs: "/app/packs",
  };
  const result = childEnvironment(source, config);
  for (const key of [
    "GEMINI_API_KEY",
    "DATABASE_URL",
    "HTTP_PROXY",
    "NODE_OPTIONS",
  ])
    assert.equal(result[key], undefined);
  assert.equal(result.JWT_SECRET, "new");
  assert.equal(result.USE_STUB_LLM, "false");
  assert.equal(result.LOCAL_UNLIMITED, "false");
  assert.equal(result.LOCAL_DESKTOP, "true");
  assert.equal(result.PORT, "0");
});

test("renderer cannot write extra preferences or consent timestamps", () => {
  assert.deepEqual(validatePreferences({ shareAnalytics: true }, true), {
    shareAnalytics: true,
  });
  for (const patch of [
    { shareAnalytics: "true" },
    { theme: "other" },
    { apiKey: "secret" },
    { analyticsSince: 1 },
    null,
    [],
  ])
    assert.throws(() => validatePreferences(patch, true));
  const policy = contentSecurityPolicy("http://127.0.0.1:12345");
  assert.match(policy, /connect-src 'self' ws:\/\/127.0.0.1:12345;/);
  assert.match(policy, /frame-src 'none'/);
  assert.doesNotMatch(policy, /https:/);
});
