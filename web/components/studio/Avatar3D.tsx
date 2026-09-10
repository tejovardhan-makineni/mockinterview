"use client";

// Original vector character artwork created for this project. No third-party
// avatar assets, likenesses, textures or fonts are used. AGPL-3.0, same as project.
import { memo, useEffect, useRef, type MutableRefObject } from "react";
export type AvatarDrive = {
  speaking: boolean;
  amplitude: number;
  mood: string;
  level?: number;
  bright?: number;
};
export const INTERVIEWERS = [
  { id: "alex", name: "Alex" },
  { id: "jordan", name: "Jordan" },
  { id: "sam", name: "Sam" },
];
export function interviewerName(id?: string) {
  return INTERVIEWERS.find((p) => p.id === id)?.name ?? "Alex";
}
function Portrait({
  faceId,
  drive,
}: {
  faceId: string;
  drive: MutableRefObject<AvatarDrive>;
}) {
  const mouth = useRef<SVGEllipseElement>(null);
  const head = useRef<SVGGElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const skin =
    faceId === "jordan" ? "#a76d50" : faceId === "sam" ? "#d69b76" : "#e2b18d";
  const hair = faceId === "sam" ? "#73736d" : "#343d35";
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const loop = (time: number) => {
      const d = drive.current;
      const speaking = d.speaking && !reduce.matches;
      mouth.current?.setAttribute(
        "ry",
        String(speaking ? 2 + Math.min(1, d.level ?? d.amplitude) * 5 : 1.4),
      );
      head.current?.setAttribute(
        "transform",
        reduce.matches
          ? ""
          : "rotate(" + Math.sin(time / 3800) * 0.6 + " 160 142)",
      );
      const blink = !reduce.matches && time % 4800 < 120;
      eyes.current?.setAttribute(
        "transform",
        blink ? "translate(0 141) scale(1 .15) translate(0 -141)" : "",
      );
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [drive]);
  return (
    <div className="interviewer-portrait">
      <svg
        viewBox="0 0 320 320"
        role="img"
        aria-label={interviewerName(faceId) + ", illustrated AI interviewer"}
      >
        <rect width="320" height="320" fill="#e6eee5" />
        <path d="M0 234 Q155 175 320 220 V320 H0Z" fill="#d7e2d7" />
        <rect x="229" y="33" width="65" height="109" rx="7" fill="#f6f8f1" />
        <path
          d="M249 127V57M245 98Q224 75 245 76M253 113Q283 88 265 88M251 78Q269 61 268 51"
          stroke="#a8b69c"
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
        />
        <path d="M49 320Q53 228 127 220H193Q266 228 272 320" fill="#365747" />
        <path d="M126 222L158 272L193 222" fill="#f4f1e7" />
        <path d="M137 191V233Q161 256 183 233V191" fill={skin} />
        <g ref={head}>
          <ellipse cx="110" cy="155" rx="12" ry="20" fill={skin} />
          <ellipse cx="211" cy="155" rx="12" ry="20" fill={skin} />
          <path
            d="M107 117Q107 57 160 57Q216 57 215 122L206 185Q190 219 161 223Q130 218 115 185Z"
            fill={skin}
          />
          <path
            d="M106 143Q89 111 108 79Q129 40 172 46Q223 50 224 106L212 143L204 109Q181 118 163 83Q145 112 116 113L113 144Z"
            fill={hair}
          />
          {faceId === "jordan" && (
            <path
              d="M106 105Q86 69 116 60Q106 39 139 35Q167 21 184 40Q222 27 231 63Q252 80 221 109L204 93Q174 109 160 70Q138 109 106 105Z"
              fill={hair}
            />
          )}
          <path
            d="M128 129Q138 124 148 129M174 129Q184 124 194 129"
            stroke={hair}
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
          />
          <g ref={eyes}>
            <ellipse cx="139" cy="142" rx="9" ry="5" fill="#fbf5e9" />
            <ellipse cx="185" cy="142" rx="9" ry="5" fill="#fbf5e9" />
            <circle cx="140" cy="142" r="3.7" fill="#354335" />
            <circle cx="184" cy="142" r="3.7" fill="#354335" />
            <circle cx="141" cy="141" r="1" fill="white" />
            <circle cx="185" cy="141" r="1" fill="white" />
          </g>
          <path
            d="M160 145L155 165Q160 169 166 165"
            stroke="#a86f51"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M143 185Q161 196 178 184"
            stroke="#a0614e"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          <ellipse
            ref={mouth}
            cx="161"
            cy="184"
            rx="12"
            ry="1.4"
            fill="#754b3d"
          />
          {faceId === "sam" && (
            <g fill="none" stroke="#485349" strokeWidth="3">
              <rect x="122" y="133" width="31" height="20" rx="7" />
              <rect x="170" y="133" width="31" height="20" rx="7" />
              <path d="M153 139H170" />
            </g>
          )}
        </g>
        <path
          d="M92 276L85 320M230 276L238 320"
          stroke="#284735"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
export const Avatar3D = memo(Portrait);
