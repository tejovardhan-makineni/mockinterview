import { APP_EDITION, APP_VERSION, BUILD_ID } from "@/lib/version";

export function AppVersion({ showBuild = false }: { showBuild?: boolean }) {
  return (
    <span title={BUILD_ID ? `Build ${BUILD_ID}` : undefined}>
      {APP_EDITION} v{APP_VERSION}
      {showBuild && BUILD_ID && (
        <>
          {" · "}build <code>{BUILD_ID}</code>
        </>
      )}
    </span>
  );
}
