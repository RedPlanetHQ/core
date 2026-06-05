import { useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { useTypedMatchesData } from "~/hooks/useTypedMatchData";
import { EYE_PATTERNS, EYE_VIEWBOX } from "./eye-patterns";

/** Shape of the root loader fields we read from. Kept local to avoid an
 *  import cycle through root.tsx; mirrors the metadata fields written by
 *  the workspace-settings action. */
type RootLoaderShape = {
  currentWorkspace?: { metadata?: Record<string, unknown> | null } | null;
};

/** Read the workspace-level agent-eye preference from root loader data.
 *  Returns nulls when called outside a route tree, so callers can fall back.
 *  Uses `useTypedMatchesData` because root.tsx serializes with typedjson. */
function useWorkspaceEyePrefs(): { eye?: string; eyeColor?: string } {
  const root = useTypedMatchesData<RootLoaderShape>({ id: "root" });
  const meta = (root?.currentWorkspace?.metadata ?? {}) as Record<string, unknown>;
  return {
    eye: typeof meta.agentEye === "string" ? meta.agentEye : undefined,
    eyeColor:
      typeof meta.agentEyeColor === "string" ? meta.agentEyeColor : undefined,
  };
}

export interface SamAvatarProps {
  /** Pixel size of the rendered avatar (renders as a square). */
  size?: number;
  /** Eye sprite id, e.g. "bot-pixel-classic". When omitted, reads from the
   *  root loader's `currentWorkspace.metadata.agentEye`. */
  eye?: string;
  /** Hex color for the eye pixels (primary shade). When omitted, reads from
   *  the root loader's `currentWorkspace.metadata.agentEyeColor`. */
  eyeColor?: string;
  /** When true, the eyes follow the user's cursor. Defaults to false. */
  trackCursor?: boolean;
  className?: string;
}

export const DEFAULT_SAM_EYE = "bot-pixel-classic";
export const DEFAULT_SAM_EYE_COLOR = "#74E07A";

export const SAM_EYE_OPTIONS: Array<{
  id: string;
  label: string;
  group: "pixel" | "solid";
  desc: string;
}> = [
  { id: "bot-pixel-classic", group: "pixel", label: "Classic",   desc: "Dense LED-matrix happy-eye cluster" },
  { id: "bot-pixel-led",     group: "pixel", label: "LED",       desc: "Circular LED dots with center highlight" },
  { id: "bot-pixel-diamond", group: "pixel", label: "Diamond",   desc: "Refined diamond pixel shape" },
  { id: "bot-pixel-arc",     group: "pixel", label: "Arc",       desc: "Low warm arc — gentle, content" },
  { id: "bot-pixel-soft",    group: "pixel", label: "Soft",      desc: "Subtle dot pairs — minimal" },
  { id: "bot-pixel-scan",    group: "pixel", label: "Scan",      desc: "Horizontal scanning bar — active" },
  { id: "bot-attentive",     group: "solid", label: "Attentive", desc: "Steady neutral gaze" },
  { id: "bot-thinking",      group: "solid", label: "Thinking",  desc: "Cluster + offset pixel" },
  { id: "bot-focused",       group: "solid", label: "Focused",   desc: "Narrow slits" },
  { id: "bot-zen",           group: "solid", label: "Zen",       desc: "Closed crescents" },
  { id: "bot-spark",         group: "solid", label: "Spark",     desc: "Cluster + twinkle" },
  { id: "bot-night",         group: "solid", label: "Night",     desc: "Steady gaze, indigo" },
];

/** Curated palette for the eye-color picker. */
export const SAM_EYE_COLOR_OPTIONS: Array<{ id: string; hex: string; label: string }> = [
  { id: "green",   hex: "#74E07A", label: "Green" },
  { id: "blue",    hex: "#5AB0F4", label: "Blue" },
  { id: "amber",   hex: "#FFB84D", label: "Amber" },
  { id: "cyan",    hex: "#4DD0E1", label: "Cyan" },
  { id: "indigo",  hex: "#6B8AF7", label: "Indigo" },
  { id: "magenta", hex: "#F472B6", label: "Magenta" },
  { id: "cream",   hex: "#F5E8C8", label: "Cream" },
  { id: "white",   hex: "#FFFFFF", label: "White" },
];

// ============================================================================
// Layout constants — viewBox matches the current head.svg (380×287)
// The new head.svg renders its own body + screen, so no reconstructed rects.
// ============================================================================
const HEAD_VIEW_W = 380;
const HEAD_VIEW_H = 287;

// Eye overlay — centered. Tune these if the eyes don't land in the right spot.
const EYE_W = 280;
const EYE_H = 105;
const EYE_X = (HEAD_VIEW_W - EYE_W) / 2;
const EYE_Y = (HEAD_VIEW_H - EYE_H) / 2 - 8; // slightly above center

// Max distance (in head viewBox units) the eyes can drift when tracking cursor.
const CURSOR_MAX_OFFSET_X = 22;
const CURSOR_MAX_OFFSET_Y = 14;
// Distance (in screen px) at which the eye reaches max offset; closer = less drift.
const CURSOR_RAMP_DISTANCE = 250;

// Blink: how often (random in this range) and how long the closed phase lasts.
const BLINK_INTERVAL_MIN_MS = 3000;
const BLINK_INTERVAL_MAX_MS = 6000;
const BLINK_CLOSED_MS = 130;
// Sprite is 64 wide → x=32 is the centerline between left and right eyes.
const EYE_SPLIT_X = 32;
// Approx vertical center of the right eye in sprite coords (used as transform-origin).
const RIGHT_EYE_CENTER_X = 42;
const RIGHT_EYE_CENTER_Y = 12;

// ============================================================================
// Eye color shading
// ============================================================================
/** Lighten a hex color toward white by `amount` (0–1). */
function lighten(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

// ============================================================================
// Component
// ============================================================================
export function SamAvatar({
  size = 32,
  eye,
  eyeColor,
  trackCursor = false,
  className,
}: SamAvatarProps) {
  // Fallback chain: explicit prop → workspace prefs (from root loader) → default
  const workspacePrefs = useWorkspaceEyePrefs();
  const resolvedEye = eye ?? workspacePrefs.eye ?? DEFAULT_SAM_EYE;
  const resolvedColor =
    eyeColor ?? workspacePrefs.eyeColor ?? DEFAULT_SAM_EYE_COLOR;

  const pattern = EYE_PATTERNS[resolvedEye] ?? EYE_PATTERNS[DEFAULT_SAM_EYE];
  const brightColor = lighten(resolvedColor, 0.45);

  // Map the eye sprite's 64×24 internal viewBox into our screen coords.
  const eyeScaleX = EYE_W / EYE_VIEWBOX.w;
  const eyeScaleY = EYE_H / EYE_VIEWBOX.h;

  // Cursor tracking — bypass React entirely on mousemove. Each move updates a
  // ref-held transform via a single rAF tick; no re-renders, no transition lag.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const eyeGroupRef = useRef<SVGGElement | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!trackCursor) return;
    let nextDx = 0;
    let nextDy = 0;
    const handleMove = (e: MouseEvent) => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const ramp = Math.min(1, dist / CURSOR_RAMP_DISTANCE);
      nextDx = (dx / dist) * CURSOR_MAX_OFFSET_X * ramp;
      nextDy = (dy / dist) * CURSOR_MAX_OFFSET_Y * ramp;
      if (rafIdRef.current == null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          const g = eyeGroupRef.current;
          if (!g) return;
          g.setAttribute(
            "transform",
            `translate(${EYE_X + nextDx} ${EYE_Y + nextDy}) scale(${eyeScaleX} ${eyeScaleY})`,
          );
        });
      }
    };
    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMove);
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    };
  }, [trackCursor, eyeScaleX, eyeScaleY]);

  // Random one-eye blink — winks the RIGHT eye every 3–6 s.
  const [isBlinking, setIsBlinking] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay =
        BLINK_INTERVAL_MIN_MS +
        Math.random() * (BLINK_INTERVAL_MAX_MS - BLINK_INTERVAL_MIN_MS);
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        setIsBlinking(true);
        timeoutId = setTimeout(() => {
          if (cancelled) return;
          setIsBlinking(false);
          schedule();
        }, BLINK_CLOSED_MS);
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${HEAD_VIEW_W} ${HEAD_VIEW_H}`}
      xmlns="http://www.w3.org/2000/svg"
      className={cn("inline-block shrink-0", className)}
      role="img"
      aria-label="SAM-1 avatar"
      preserveAspectRatio="xMidYMid meet"
    >
      <image
        href="/head.svg"
        x="0" y="0" width={HEAD_VIEW_W} height={HEAD_VIEW_H}
      />
      {/* Eye-pair group — translated to screen position, scaled to fit. */}
      <g
        ref={eyeGroupRef}
        transform={`translate(${EYE_X} ${EYE_Y}) scale(${eyeScaleX} ${eyeScaleY})`}
      >
        {pattern.map((group, gi) => {
          const color = group.shade === "bright" ? brightColor : resolvedColor;
          const leftRects = group.rects.filter(([x]) => x < EYE_SPLIT_X);
          const rightRects = group.rects.filter(([x]) => x >= EYE_SPLIT_X);
          return (
            <g key={gi} fill={color}>
              {leftRects.map(([x, y, w, h], i) => (
                <rect key={`l${i}`} x={x} y={y} width={w} height={h} />
              ))}
              <g
                style={{
                  transformOrigin: `${RIGHT_EYE_CENTER_X}px ${RIGHT_EYE_CENTER_Y}px`,
                  transform: isBlinking ? "scaleY(0.05)" : "scaleY(1)",
                  transition: "transform 90ms ease-out",
                }}
              >
                {rightRects.map(([x, y, w, h], i) => (
                  <rect key={`r${i}`} x={x} y={y} width={w} height={h} />
                ))}
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
