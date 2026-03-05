import type { IconProps } from "./types";

export function Resend({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M4 2h9.5a6.5 6.5 0 0 1 0 13H11l7 7h-3.5L7 15H7v7H4V2zm3 3v7h6.5a3.5 3.5 0 0 0 0-7H7z" />
    </svg>
  );
}
