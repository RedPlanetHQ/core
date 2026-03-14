import type { IconProps } from "./types";

export function BlockedLine({ size = 18, className, color }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0_5074_4822)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 6C12 9.3137 9.3137 12 6 12C2.6863 12 0 9.3137 0 6C0 2.6863 2.6863 0 6 0C9.3137 0 12 2.6863 12 6ZM6 10.5C6.93465 10.5015 7.84635 10.2106 8.6074 9.668L2.332 3.3926C1.808 4.1282 1.5 5.0281 1.5 6C1.5 8.4853 3.5147 10.5 6 10.5ZM3.3926 2.3319L9.6681 8.6074C10.2107 7.84635 10.5015 6.93465 10.5 6C10.5 3.5147 8.4853 1.5 6 1.5C5.06536 1.49849 4.15366 1.78937 3.3926 2.3319Z"
          fill={color ? color : "currentColor"}
        />
      </g>
      <defs>
        <clipPath id="clip0_5074_4822">
          <rect width={size} height={size} fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
