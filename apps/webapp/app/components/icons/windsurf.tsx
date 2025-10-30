import type { IconProps } from "./types";

export function Windsurf({ size = 18, className }: IconProps) {
  return (
    <svg
      fill="currentColor"
      viewBox="0 0 24 24"
      height={size}
      className={className}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Windsurf</title>
      <path d="M3 14l3-3 4 4-3 3-4-4zm7-7l3-3 4 4-3 3-4-4zm7 0l4-4 3 3-4 4-3-3zM7 21l10-10 3 3-10 10-3-3z" />
    </svg>
  );
}
