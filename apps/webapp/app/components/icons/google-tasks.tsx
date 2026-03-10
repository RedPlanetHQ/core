import type { IconProps } from "./types";

export function GoogleTasks({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      fill="#3b82f6"
    >
      <path
        fill="#3b82f6"
        d="M16.768 5.714a2 2 0 0 1 3.064 2.572L10.833 19.01a2 2 0 1 1-3.064-2.57l8.999-10.726ZM3 12.74a2 2 0 1 1 4 0a2 2 0 0 1-4 0Z"
      />
    </svg>
  );
}
