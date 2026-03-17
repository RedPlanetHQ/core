import type { IconProps } from "./types";

export function Mixpanel({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="12" fill="#7856FF" />
      <path
        d="M12 44V20l10 14 10-14v24"
        stroke="#FFFFFF"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M36 32a8 8 0 1 1 16 0 8 8 0 0 1-16 0Z"
        stroke="#FFFFFF"
        strokeWidth="4"
        fill="none"
      />
    </svg>
  );
}
