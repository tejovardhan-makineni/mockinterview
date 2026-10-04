export const COMMUNITY = Object.freeze({
  github: "https://github.com/tejovardhan-makineni/mockinterview",
  releases: "https://github.com/tejovardhan-makineni/mockinterview/releases",
  discord: "https://discord.gg/KvGunFKZwS",
  reddit: "https://www.reddit.com/r/mockinterview_live/",
  x: "https://x.com/mockinterviewlv?s=11",
  website: "https://mockinterview.live",
});

const SUPPORT_DOCUMENTS = Object.freeze([
  "https://ai.google.dev/gemini-api/docs/billing",
  "https://ai.google.dev/gemini-api/terms",
  "https://cloud.google.com/terms/cloud-privacy-notice",
  "https://cloud.google.com/terms/data-processing-addendum",
  "https://business.safety.google/processorterms/",
  "https://resend.com/legal/privacy-policy",
  "https://resend.com/legal/dpa",
  "https://openai.com/business-data/",
  "https://www.anthropic.com/legal/commercial-terms",
  "https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html",
  "https://x.ai/legal/data-processing-addendum",
]);

export function isAllowedExternal(value) {
  if (value === "mailto:makinenitejovardhan@gmail.com") return true;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return false;
    if (
      SUPPORT_DOCUMENTS.some((value) => {
        const allowed = new URL(value);
        return (
          url.origin === allowed.origin &&
          url.pathname.replace(/\/$/, "") ===
            allowed.pathname.replace(/\/$/, "")
        );
      })
    )
      return true;
    return Object.values(COMMUNITY).some((base) => {
      const allowed = new URL(base);
      const prefix = allowed.pathname.replace(/\/$/, "");
      return (
        url.hostname === allowed.hostname &&
        (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
      );
    });
  } catch {
    return false;
  }
}

export function sameAppOrigin(value, origin) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.origin === origin &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function isBackendRequest(value, origin) {
  try {
    const url = new URL(value);
    if (url.protocol === "ws:") url.protocol = "http:";
    return sameAppOrigin(url.href, origin);
  } catch {
    return false;
  }
}

export function bridgeHeaders(headers, requestURL, origin, token) {
  const clean = Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => name.toLowerCase() !== "x-desktop-token",
    ),
  );
  if (isBackendRequest(requestURL, origin)) clean["X-Desktop-Token"] = token;
  return clean;
}

export function parseReady(line) {
  try {
    const event = JSON.parse(line);
    if (event.msg !== "desktop_ready") return null;
    const url = new URL(event.url);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function childEnvironment(source, config) {
  const allowed = [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ];
  const env = Object.fromEntries(
    allowed
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
  return {
    ...env,
    APP_ENV: "development",
    LOCAL_DESKTOP: "true",
    LOCAL_MEMORY: "false",
    LOCAL_UNLIMITED: "false",
    USE_STUB_LLM: "false",
    PORT: "0",
    LISTEN_HOST: "127.0.0.1",
    DESKTOP_DB_PATH: config.database,
    DESKTOP_WEB_DIR: config.web,
    DESKTOP_BRIDGE_TOKEN: config.bridgeToken,
    JWT_SECRET: config.jwtSecret,
    SESSION_ENCRYPTION_KEY: config.encryptionKey,
    CORPUS_DIR: config.corpus,
    PACKS_DIR: config.packs,
    RELEASE_SHA: config.releaseSHA || "desktop",
  };
}

export const DEFAULT_PREFERENCES = Object.freeze({
  shareAnalytics: false,
  shareInterviewResults: false,
  theme: "system",
});
export function validatePreferences(value, partial = false) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid preferences");
  const result = partial ? {} : { ...DEFAULT_PREFERENCES };
  for (const [key, field] of Object.entries(value)) {
    if (
      (key === "shareAnalytics" || key === "shareInterviewResults") &&
      typeof field === "boolean"
    )
      result[key] = field;
    else if (key === "theme" && ["light", "dark", "system"].includes(field))
      result[key] = field;
    else throw new Error("Invalid preferences");
  }
  return result;
}

export function contentSecurityPolicy(origin) {
  const wsOrigin = origin.replace(/^http:/, "ws:");
  // Static Next exports contain inline hydration scripts. All executable files
  // and workers remain bundled; remote scripts, frames, objects and forms are denied.
  return `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${wsOrigin}; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'`;
}
