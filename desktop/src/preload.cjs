const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "mockInterviewDesktop",
  Object.freeze({
    preferences: Object.freeze({
      get: () => ipcRenderer.invoke("desktop:preferences:get"),
      set: (patch) => ipcRenderer.invoke("desktop:preferences:set", patch),
    }),
  }),
);
