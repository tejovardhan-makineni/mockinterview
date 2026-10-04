/** Compile-time boundary: desktop practice never uses the hosted interview API. */
export const IS_DESKTOP = process.env.NEXT_PUBLIC_DESKTOP === "1";

export interface DesktopPreferences {
  shareAnalytics: boolean;
  shareInterviewResults: boolean;
  analyticsSince: number;
  resultsSince: number;
  theme: "light" | "dark" | "system";
}
declare global {
  interface Window {
    mockInterviewDesktop?: {
      preferences: {
        get(): Promise<DesktopPreferences>;
        set(
          update: Partial<
            Pick<
              DesktopPreferences,
              "shareAnalytics" | "shareInterviewResults" | "theme"
            >
          >,
        ): Promise<DesktopPreferences>;
      };
    };
  }
}
let preferences: DesktopPreferences = {
  shareAnalytics: false,
  shareInterviewResults: false,
  analyticsSince: 0,
  resultsSince: 0,
  theme: "system",
};
export function desktopPreferences() {
  return preferences;
}
export async function loadDesktopPreferences() {
  if (!IS_DESKTOP || typeof window === "undefined") return;
  const saved = await window.mockInterviewDesktop?.preferences.get();
  if (saved) {
    preferences = saved;
    if (saved.theme !== "system")
      document.documentElement.dataset.theme = saved.theme;
    window.dispatchEvent(new Event("mi-analytics-change"));
  }
}
export async function saveDesktopPreferences(
  update: Parameters<
    NonNullable<Window["mockInterviewDesktop"]>["preferences"]["set"]
  >[0],
) {
  // Withdrawal takes effect in memory before a disk/IPC round trip.
  if (
    update.shareAnalytics === false ||
    update.shareInterviewResults === false
  ) {
    preferences = {
      ...preferences,
      ...(update.shareAnalytics === false
        ? { shareAnalytics: false, analyticsSince: 0 }
        : {}),
      ...(update.shareInterviewResults === false
        ? { shareInterviewResults: false, resultsSince: 0 }
        : {}),
    };
    window.dispatchEvent(new Event("mi-analytics-change"));
  }
  const bridge = window.mockInterviewDesktop;
  if (!bridge)
    throw new Error(
      "Desktop preferences are unavailable. Restart the app and try again.",
    );
  preferences = await bridge.preferences.set(update);
  window.dispatchEvent(new Event("mi-analytics-change"));
}
