import type { IconProps } from "./types";

export function Metabase({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M3 3h3.8L12 10.6 17.2 3H21v18h-3.8V9.2L12 16.8 6.8 9.2V21H3V3z" />
    </svg>
  );
}
