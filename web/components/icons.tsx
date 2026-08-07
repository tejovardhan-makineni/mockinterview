// Modern line-icon set (Lucide-style, 24×24, stroke=currentColor). Inline SVG so
// it works under the strict CSP with no external requests. Every icon takes a
// className (size/color via Tailwind) and inherits color from `currentColor`.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function Svg({ children, className, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" {...rest}
    >
      {children}
    </svg>
  );
}

// ---- Nav ----
export const IconDashboard = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Svg>
);
export const IconInterview = (p: IconProps) => (
  <Svg {...p}><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" /><path d="M19 11a7 7 0 0 1-14 0" /><path d="M12 18v3" /></Svg>
);
export const IconResume = (p: IconProps) => (
  <Svg {...p}><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path d="M9 9h1" /><path d="M9 13h6" /><path d="M9 17h6" /></Svg>
);
export const IconResults = (p: IconProps) => (
  <Svg {...p}><path d="M3 3v18h18" /><path d="M7 15l3-4 3 2 4-6" /></Svg>
);
export const IconSettings = (p: IconProps) => (
  <Svg {...p}><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></Svg>
);
export const IconSignOut = (p: IconProps) => (
  <Svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></Svg>
);

// ---- Studio / status ----
export const IconMic = (p: IconProps) => (
  <Svg {...p}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M19 11a7 7 0 0 1-14 0" /><path d="M12 18v3" /></Svg>
);
export const IconMicOff = (p: IconProps) => (
  <Svg {...p}><path d="M2 2l20 20" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /><path d="M15 9.34V6a3 3 0 0 0-5.94-.6" /><path d="M19 11a7 7 0 0 1-.9 3.4M5 11a7 7 0 0 0 10 6.32" /><path d="M12 18v3" /></Svg>
);
export const IconSpeaker = (p: IconProps) => (
  <Svg {...p}><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></Svg>
);
export const IconWave = (p: IconProps) => (
  <Svg {...p}><path d="M2 12h2" /><path d="M6 8v8" /><path d="M10 5v14" /><path d="M14 8v8" /><path d="M18 10v4" /><path d="M22 12h0" /></Svg>
);
export const IconThinking = (p: IconProps) => (
  <Svg {...p}><path d="M12 3a5 5 0 0 1 5 5c0 1.7-.9 3.2-2.2 4.1-.5.4-.8 1-.8 1.6V15H10v-1.3c0-.6-.3-1.2-.8-1.6A5 5 0 0 1 12 3Z" /><path d="M9 18h6" /><path d="M10 21h4" /></Svg>
);
export const IconConnected = (p: IconProps) => (
  <Svg {...p}><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 16a5 5 0 0 1 7 0" /><path d="M2 9a15 15 0 0 1 20 0" /><path d="M12 20h.01" /></Svg>
);
export const IconDisconnected = (p: IconProps) => (
  <Svg {...p}><path d="M2 2l20 20" /><path d="M8.5 16a5 5 0 0 1 6-.8" /><path d="M5 12.5a10 10 0 0 1 3.5-2.3" /><path d="M2 9a15 15 0 0 1 4.6-3" /><path d="M16.7 9.5A15 15 0 0 1 22 9" /><path d="M12 20h.01" /></Svg>
);
export const IconReconnect = (p: IconProps) => (
  <Svg {...p}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></Svg>
);
export const IconStop = (p: IconProps) => (
  <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>
);
export const IconPlay = (p: IconProps) => (
  <Svg {...p}><path d="M7 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 7 5.5Z" /></Svg>
);
export const IconClock = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
);

// ---- Brand ----
// A clean single lowercase "m" in a rounded badge — the mockinterview.live mark.
// A simple, unmistakable lowercase "m" glyph, centred in the tile. Positioned by
// an explicit alphabetic baseline (y=21.5) + text-anchor=middle rather than
// dominant-baseline (whose vertical centring drifts between renderers), and a
// system-sans stack so it renders identically without the webfont. app/icon.svg
// mirrors this exactly so the browser-tab favicon matches the header logo.
export const LogoM = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 32 32" width="1em" height="1em" className={className} aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--color-accent)" />
    <text
      x="16" y="21.5" textAnchor="middle"
      fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
      fontWeight="800" fontSize="19" fill="var(--color-studio)"
    >m</text>
  </svg>
);
