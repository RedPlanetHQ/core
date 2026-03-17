import type { IconProps } from './types';

export function GoogleSearchConsole({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
    >
      <path fill="#4caf50" d="M24 4C13 4 4 13 4 24s9 20 20 20 20-9 20-20S35 4 24 4z" />
      <path
        fill="#fff"
        d="M24 10c-7.7 0-14 6.3-14 14s6.3 14 14 14 14-6.3 14-14-6.3-14-14-14zm0 25c-6.1 0-11-4.9-11-11s4.9-11 11-11 11 4.9 11 11-4.9 11-11 11z"
      />
      <circle cx="24" cy="24" r="5" fill="#fff" />
      <path
        fill="#fff"
        d="M33.2 14.8l-6.4 6.4c.8.9 1.2 2 1.2 3.2 0 .4 0 .8-.1 1.2l6.9 2.3c.2-.9.2-1.7.2-2.6 0-3.8-1.4-7.3-3.8-9.8-.1 0 0-.3 0-.7z"
      />
    </svg>
  );
}
