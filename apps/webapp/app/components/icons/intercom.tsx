import type { IconProps } from './types';

export function Intercom({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      viewBox="0 0 32 32"
      fill="none"
    >
      <rect width="32" height="32" rx="6" fill="#1F8DED" />
      <path
        d="M24 20.308C24 21.243 23.243 22 22.308 22H9.692C8.757 22 8 21.243 8 20.308V11.692C8 10.757 8.757 10 9.692 10H22.308C23.243 10 24 10.757 24 11.692V20.308Z"
        fill="white"
      />
      <path
        d="M16 18C14.343 18 13 16.657 13 15C13 13.343 14.343 12 16 12C17.657 12 19 13.343 19 15C19 16.657 17.657 18 16 18Z"
        fill="#1F8DED"
      />
      <path
        d="M13 22L11 25"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M19 22L21 25"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
