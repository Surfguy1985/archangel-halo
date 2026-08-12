export function HaloRing({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="gg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E4C577"/>
          <stop offset=".55" stopColor="#B98A2F"/>
          <stop offset="1" stopColor="#8F6A1F"/>
        </linearGradient>
      </defs>
      <circle
        cx="16" cy="16" r="12.5"
        fill="none"
        stroke="url(#gg)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="70 9"
        transform="rotate(-58 16 16)"
        className="animate-[spin_20s_linear_infinite]"
      />
    </svg>
  );
}
