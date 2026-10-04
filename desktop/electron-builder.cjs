const path = require("node:path");

module.exports = {
  appId: "live.mockinterview.desktop",
  productName: "Mock Interview",
  asar: true,
  directories: { output: "dist", buildResources: "build" },
  icon: "build/icon.png",
  files: ["src/**", "package.json", "LICENSE"],
  extraResources: [{ from: "resources", to: "runtime", filter: ["**/*"] }],
  artifactName: "MockInterview-${version}-${os}-${arch}.${ext}",
  publish: [
    {
      provider: "github",
      owner: "tejovardhan-makineni",
      repo: "mockinterview",
      releaseType: "draft",
    },
  ],
  mac: {
    category: "public.app-category.education",
    target: ["dmg", "zip"],
    identity: process.env.CSC_LINK ? undefined : process.env.CSC_NAME || "-",
    hardenedRuntime: Boolean(process.env.CSC_LINK || process.env.CSC_NAME),
    gatekeeperAssess: false,
    notarize: Boolean(
      process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID,
    ),
    binaries: ["Contents/Resources/runtime/bin/mockinterview-api"],
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Use your microphone for spoken interview practice.",
      NSCameraUsageDescription:
        "Preview your camera during interview practice.",
    },
  },
  win: {
    target: ["nsis"],
    artifactName: "MockInterview-${version}-windows-${arch}-setup.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Education",
    executableName: "mockinterview",
    maintainer: "Mock Interview contributors <makinenitejovardhan@gmail.com>",
  },
  afterPack: async (context) => {
    const { flipFuses, FuseVersion, FuseV1Options } =
      await import("@electron/fuses");
    const platform = context.electronPlatformName;
    const executable =
      platform === "darwin"
        ? path.join(
            context.appOutDir,
            "Mock Interview.app",
            "Contents",
            "MacOS",
            "Mock Interview",
          )
        : path.join(
            context.appOutDir,
            platform === "win32" ? "Mock Interview.exe" : "mockinterview",
          );
    await flipFuses(executable, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
        platform !== "linux",
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    });
  },
};
