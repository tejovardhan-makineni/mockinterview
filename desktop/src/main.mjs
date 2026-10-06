import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  safeStorage,
  session,
  ipcMain,
  systemPreferences,
} from "electron";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, access } from "node:fs/promises";
import { appendFileSync, existsSync } from "node:fs";
import {
  COMMUNITY,
  isAllowedExternal,
  sameAppOrigin,
  isBackendRequest,
  bridgeHeaders,
  childEnvironment,
  parseReady,
  contentSecurityPolicy,
} from "./security.mjs";
import { installSecrets, preferencesStore } from "./storage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let backend;
let quitting = false;
let origin;
app.enableSandbox();
app.setName("Mock Interview");

const diagnostics =
  process.argv.includes("--diagnostics") ||
  existsSync(path.join(app.getPath("userData"), "diagnostics.enabled"));
function diagnostic(event, fields = {}) {
  if (!diagnostics) return;
  // Local troubleshooting metadata only: never record messages, page content,
  // full URLs, query strings, request headers, payloads or credentials.
  try {
    appendFileSync(
      path.join(app.getPath("userData"), "desktop-diagnostics.jsonl"),
      `${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`,
      { mode: 0o600 },
    );
  } catch {
    /* Diagnostics must not block practice. */
  }
}
function diagnosticPath(value) {
  try {
    const url = new URL(value);
    if (url.pathname.startsWith("/_next/")) return "next-asset";
    if (
      [
        "/",
        "/api/v1/desktop/bootstrap",
        "/api/v1/questions",
        "/api/v1/professions",
      ].includes(url.pathname)
    )
      return url.pathname;
    return "app-resource";
  } catch {
    return "unavailable";
  }
}
diagnostic("main-loaded");

async function openCommunity(url) {
  if (isAllowedExternal(url)) await shell.openExternal(url);
}

function installMenu() {
  const template = [
    ...(process.platform === "darwin"
      ? [{ role: "appMenu" }]
      : [{ label: "File", submenu: [{ role: "quit" }] }]),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        {
          label: "Source and contributions on GitHub",
          click: () => void openCommunity(COMMUNITY.github),
        },
        {
          label: "Join Discord",
          click: () => void openCommunity(COMMUNITY.discord),
        },
        {
          label: "Join Reddit",
          click: () => void openCommunity(COMMUNITY.reddit),
        },
        {
          label: "Follow on X",
          click: () => void openCommunity(COMMUNITY.x),
        },
        { type: "separator" },
        {
          label: "Download updates on GitHub…",
          click: () => void openCommunity(COMMUNITY.releases),
        },
        {
          label: "Open app data folder",
          click: () => void shell.openPath(app.getPath("userData")),
        },
        {
          label: "About desktop privacy",
          click: () =>
            void dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "Desktop privacy",
              message: "Saved on this computer",
              detail:
                "Interviews and results stay in this app’s local database. Analytics and result sharing are optional. Your AI provider receives the content needed for interviews. Desktop requires your own API key. Updates are downloaded from the project’s GitHub Releases.",
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function assertSender(event) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !sameAppOrigin(event.senderFrame.url, origin)
  ) {
    throw new Error("Untrusted window");
  }
}

function installSecurity(appSession, bridgeToken, preferences) {
  if (diagnostics) {
    appSession.webRequest.onCompleted((details) =>
      diagnostic("http-complete", {
        path: diagnosticPath(details.url),
        status: details.statusCode,
      }),
    );
    appSession.webRequest.onErrorOccurred((details) =>
      diagnostic("http-error", {
        path: diagnosticPath(details.url),
        error: details.error,
      }),
    );
  }
  appSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed =
      isBackendRequest(details.url, origin) ||
      details.url.startsWith(`blob:${origin}/`) ||
      details.url.startsWith("data:");
    callback({ cancel: !allowed });
  });
  appSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      requestHeaders: bridgeHeaders(
        details.requestHeaders,
        details.url,
        origin,
        bridgeToken,
      ),
    });
  });
  appSession.webRequest.onHeadersReceived((details, callback) => {
    if (!sameAppOrigin(details.url, origin)) return callback({});
    const headers = { ...details.responseHeaders };
    for (const name of Object.keys(headers))
      if (
        [
          "content-security-policy",
          "referrer-policy",
          "x-frame-options",
        ].includes(name.toLowerCase())
      )
        delete headers[name];
    callback({
      responseHeaders: {
        ...headers,
        "Content-Security-Policy": [contentSecurityPolicy(origin)],
        "Referrer-Policy": ["no-referrer"],
        "X-Frame-Options": ["DENY"],
      },
    });
  });
  const approvedMedia = new Set();
  appSession.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) => {
      if (
        contents !== mainWindow?.webContents ||
        !sameAppOrigin(requestingOrigin, origin)
      )
        return false;
      if (permission === "clipboard-sanitized-write") return true;
      return (
        permission === "media" &&
        details.isMainFrame &&
        approvedMedia.has(details.mediaType)
      );
    },
  );
  appSession.setPermissionRequestHandler(
    async (contents, permission, callback, details) => {
      if (
        contents !== mainWindow?.webContents ||
        !sameAppOrigin(details.requestingUrl, origin) ||
        details.isMainFrame === false
      )
        return callback(false);
      if (permission === "clipboard-sanitized-write") return callback(true);
      if (permission !== "media") return callback(false);
      const types = details.mediaTypes || [];
      if (
        !types.length ||
        types.some((type) => !["audio", "video"].includes(type))
      )
        return callback(false);
      const label = types
        .map((type) => (type === "audio" ? "microphone" : "camera"))
        .join(" and ");
      const answer = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "Interview permissions",
        message: `Allow access to your ${label}?`,
        detail: "Used only when you turn on voice or video during practice.",
        buttons: ["Allow", "Not now"],
        defaultId: 0,
        cancelId: 1,
      });
      if (answer.response !== 0) return callback(false);
      for (const type of types) {
        if (
          process.platform === "darwin" &&
          !(await systemPreferences.askForMediaAccess(
            type === "audio" ? "microphone" : "camera",
          ))
        )
          return callback(false);
        approvedMedia.add(type);
      }
      callback(true);
    },
  );
  appSession.on("will-download", (event, item) => {
    // Reports may be exported as local blobs. Installer/executable downloads are
    // handled by the system browser, never automatically opened by the shell.
    if (
      !item.getURL().startsWith(`blob:${origin}/`) &&
      !sameAppOrigin(item.getURL(), origin)
    )
      event.preventDefault();
  });
  ipcMain.handle("desktop:preferences:get", (event) => {
    assertSender(event);
    return preferences.get();
  });
  ipcMain.handle("desktop:preferences:set", (event, patch) => {
    assertSender(event);
    return preferences.set(patch);
  });
}

async function launchBackend(resources, directory, secrets, bridgeToken) {
  const executable = path.join(
    resources,
    "bin",
    process.platform === "win32"
      ? "mockinterview-api.exe"
      : "mockinterview-api",
  );
  await access(executable);
  const manifest = JSON.parse(
    await readFile(path.join(resources, "build.json"), "utf8"),
  );
  backend = spawn(executable, [], {
    cwd: directory,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnvironment(process.env, {
      ...secrets,
      bridgeToken,
      database: path.join(directory, "interviews.sqlite"),
      web: path.join(resources, "web"),
      corpus: path.join(resources, "corpus"),
      packs: path.join(resources, "packs"),
      releaseSHA: manifest.source,
    }),
  });
  // API output can contain interview context. Consume it without persisting or
  // forwarding logs to third parties or the renderer.
  backend.stderr.resume();
  return new Promise((resolve, reject) => {
    let ready = false;
    const timeout = setTimeout(() => {
      backend.kill();
      reject(
        new Error(
          "The local interview engine did not start. Reopen the app or reinstall the latest package from GitHub.",
        ),
      );
    }, 30000);
    const lines = createInterface({ input: backend.stdout });
    lines.on("line", (line) => {
      if (ready) return;
      const address = parseReady(line);
      if (address) {
        ready = true;
        clearTimeout(timeout);
        resolve(address);
      }
    });
    backend.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("The bundled interview engine could not be opened."));
    });
    backend.once("exit", () => {
      clearTimeout(timeout);
      if (!ready)
        reject(
          new Error(
            "The local interview engine could not start. Your saved data has not been removed.",
          ),
        );
      else if (!quitting) {
        dialog.showErrorBox(
          "Interview engine stopped",
          "Reopen Mock Interview to continue. Saved interviews remain on this computer.",
        );
        app.quit();
      }
    });
  });
}

function createWindow(appSession) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: "#faf9f6",
    title: "Mock Interview · Beta",
    webPreferences: {
      session: appSession,
      preload: path.join(here, "preload.cjs"),
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!sameAppOrigin(url, origin)) {
      event.preventDefault();
      void openCommunity(url);
    }
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!sameAppOrigin(url, origin)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (sameAppOrigin(url, origin)) void mainWindow.loadURL(url);
    else void openCommunity(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-finish-load", () =>
    diagnostic("window-loaded"),
  );
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, _description, url) =>
      diagnostic("window-failed", { errorCode, path: diagnosticPath(url) }),
  );
  mainWindow.webContents.on("console-message", (details) => {
    if (details.level === "error" || details.level === "warning")
      diagnostic("renderer-console", {
        level: details.level,
        path: diagnosticPath(details.sourceId),
        line: details.lineNumber,
      });
  });
  mainWindow.webContents.on("preload-error", () =>
    diagnostic("preload-failed"),
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) =>
    diagnostic("renderer-exited", {
      reason: details.reason,
      exitCode: details.exitCode,
    }),
  );
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  return mainWindow.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      diagnostic("app-ready");
      if (diagnostics && process.platform !== "linux")
        app.setAccessibilitySupportEnabled(true);
      diagnostic("accessibility-ready");
      const directory = app.getPath("userData");
      const secrets = await installSecrets(directory, safeStorage);
      diagnostic("keychain-unlocked");
      const resources = app.isPackaged
        ? path.join(process.resourcesPath, "runtime")
        : path.resolve(here, "../resources");
      const bridgeToken = randomBytes(32).toString("hex");
      origin = await launchBackend(resources, directory, secrets, bridgeToken);
      diagnostic("backend-ready");
      const appSession = session.fromPartition("persist:mockinterview", {
        cache: false,
      });
      installSecurity(appSession, bridgeToken, preferencesStore(directory));
      installMenu();
      await createWindow(appSession);
      app.on("activate", () => {
        if (!mainWindow) void createWindow(appSession);
      });
    })
    .catch((error) => {
      diagnostic("startup-failed", { name: error.name });
      dialog.showErrorBox("Could not open Mock Interview", error.message);
      app.quit();
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  quitting = true;
  backend?.kill("SIGTERM");
});
