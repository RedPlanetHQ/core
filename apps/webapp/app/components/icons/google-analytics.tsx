import type { IconProps } from './types.tsx';

/**
 * Google Analytics 4 icon — simplified bar-chart / GA "G" mark in orange.
 */
export function GoogleAnalytics({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-label="Google Analytics"
    >
      {/* Background circle */}
      <circle cx="24" cy="24" r="22" fill="#E8710A" />

      {/* Bar chart — three rising bars (white) */}
      {/* Left bar (short) */}
      <rect x="9" y="30" width="8" height="10" rx="2" fill="#fff" />
      {/* Middle bar (medium) */}
      <rect x="20" y="22" width="8" height="18" rx="2" fill="#fff" />
      {/* Right bar (tall) */}
      <rect x="31" y="13" width="8" height="27" rx="2" fill="#fff" />
    </svg>
  );
}
