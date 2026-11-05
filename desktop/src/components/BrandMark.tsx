export function BrandMark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <circle
        cx="32"
        cy="32"
        r="22"
        stroke="currentColor"
        strokeWidth="3"
      />
      <g
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.9"
      >
        <path d="M32 10v13" />
        <path d="M51 21 39.8 27.5" />
        <path d="M51 43 39.8 36.5" />
        <path d="M32 54V41" />
        <path d="M13 43l11.2-6.5" />
        <path d="M13 21l11.2 6.5" />
      </g>
      <circle cx="32" cy="32" r="4.5" fill="currentColor" />
    </svg>
  );
}
