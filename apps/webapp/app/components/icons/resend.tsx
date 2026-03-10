import type { IconProps } from "./types";

export function Resend({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="m16.24,13.9c.93-.51,1.65-1.22,2.19-2.11.53-.91.8-1.93.8-3.06s-.27-2.07-.8-2.93c-.53-.87-1.27-1.56-2.21-2.06-.93-.5-1.96-.75-3.11-.75H5v18h4.17v-6.33h2.25l3.56,6.33h4.99l-4.03-6.94c.1-.05.2-.1.3-.16Zm-1.59-3.7c-.17.36-.43.64-.77.85-.33.19-.71.28-1.16.28h-3.55v-4.68h3.16c.55,0,1.01.09,1.39.28.39.19.69.46.9.82.21.34.31.75.31,1.21s-.09.87-.28,1.23Z" />
    </svg>
  );
}
