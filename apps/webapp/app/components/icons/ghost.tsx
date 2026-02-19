import type { IconProps } from "./types";

export function Ghost({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M12 2C7.03 2 3 6.03 3 11v8.5l2.5-2 2.5 2 2.5-2 2.5 2 2.5-2 2.5 2V11c0-4.97-4.03-9-9-9zm0 2c3.87 0 7 3.13 7 7v5.86l-1-.8-1.5 1.2-1.5-1.2-1.5 1.2-1.5-1.2-1.5 1.2-1.5-1.2-1-.8V11c0-3.87 3.13-7 7-7zm-2.5 6a1.5 1.5 0 0 0 0 3 1.5 1.5 0 0 0 0-3zm5 0a1.5 1.5 0 0 0 0 3 1.5 1.5 0 0 0 0-3z" />
    </svg>
  );
}
