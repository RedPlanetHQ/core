import type { IconProps } from "./types";

export function Codex({ size = 18, className }: IconProps) {
  return (
    <svg
      fill="currentColor"
      viewBox="0 0 24 24"
      height={size}
      className={className}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Codex</title>
      <path d="M8.5 3L3 8.5v7L8.5 21h7L21 15.5v-7L15.5 3h-7zm0 2h6.086L19 9.414v5.172L14.586 19H9.414L5 14.586V9.414L9.414 5H8.5zm2.5 3v8l6-4-6-4z" />
    </svg>
  );
}
