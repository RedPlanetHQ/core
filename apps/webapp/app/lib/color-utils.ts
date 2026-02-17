/**
 * Color utilities for handling both hex and OKLCH color formats
 */

/**
 * Check if a color string is in OKLCH format
 */
export function isOklch(color: string): boolean {
  return color.trim().toLowerCase().startsWith("oklch(");
}

/**
 * Add opacity to a color string (works with both hex and OKLCH)
 * @param color - The color string (hex or oklch)
 * @param opacity - Opacity value from 0 to 1
 */
export function withOpacity(color: string, opacity: number): string {
  if (isOklch(color)) {
    // For OKLCH: oklch(66% 0.1835 160) -> oklch(66% 0.1835 160 / 0.2)
    const trimmed = color.trim();
    // Remove closing paren, add opacity, close paren
    return trimmed.slice(0, -1) + ` / ${opacity})`;
  }

  // For hex: #ff0000 -> #ff000033 (append hex opacity)
  const hexOpacity = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");
  return color + hexOpacity;
}

/**
 * Convert OKLCH to hex color for canvas-based rendering (Sigma.js)
 * Uses a canvas element to do the conversion via CSS
 */
export function toHex(color: string): string {
  if (!isOklch(color)) {
    return color; // Already hex or other format
  }

  if (typeof document === "undefined") {
    // SSR fallback - return a default color
    return "#888888";
  }

  // Use canvas to convert OKLCH to RGB
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return "#888888";
  }

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);

  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
