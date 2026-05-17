interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 22, className = "" }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ml-mark" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent-strong)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#ml-mark)" />
      <path
        d="M9 21 L9 12 L13 18 L17 12 L17 21 M21 12 L21 21 L25 21"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
