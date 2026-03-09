import type { IconProps } from "./types";

export function Ynab({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1.5 5h3l-1.5 4.5L14.5 7H17l-4 10h-2L7 7h3.5zm1.5 8a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
    </svg>
  );
}
