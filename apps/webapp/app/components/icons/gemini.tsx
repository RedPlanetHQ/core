import type { IconProps } from "./types";

export function Gemini({ size = 18, className }: IconProps) {
  return (
    <svg
      fill="currentColor"
      viewBox="0 0 24 24"
      height={size}
      className={className}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Gemini</title>
      <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L19.82 8 12 11.82 4.18 8 12 4.18zM4 9.47l7 3.5v7.85l-7-3.5V9.47zm16 0v7.85l-7 3.5v-7.85l7-3.5z" />
    </svg>
  );
}
