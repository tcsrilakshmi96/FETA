// Feta's cheese mascot, from the design prototype. Blinks every 4.5 s.
export default function Cheese({ width = 36 }: { width?: number }) {
  return (
    <svg viewBox="0 0 80 64" width={width} height={(width * 64) / 80} style={{ display: "block", overflow: "visible" }} aria-hidden="true">
      <defs>
        <radialGradient id="cheeseHole" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#E88A06" />
          <stop offset="1" stopColor="#F7A713" />
        </radialGradient>
      </defs>
      <g transform="rotate(-8 40 32)">
        <path d="M8 24 L74 36 L72 49 Q70 52 66 52 L12 56 Q8 56 8 52 Z" fill="#FFB81E" stroke="#FFB81E" strokeWidth="4" strokeLinejoin="round" />
        <path d="M8 24 L42 11 Q45 10 47 12 L74 36 Z" fill="#FFD94A" stroke="#FFD94A" strokeWidth="4" strokeLinejoin="round" />
        <ellipse cx="40" cy="22" rx="6" ry="3" fill="url(#cheeseHole)" />
        <ellipse cx="22" cy="27" rx="3" ry="1.5" fill="#FFE98A" />
        <circle cx="15" cy="45" r="3.4" fill="url(#cheeseHole)" />
        <circle cx="14.2" cy="44" r=".8" fill="#FFE27A" />
        <circle cx="60" cy="45" r="2.6" fill="url(#cheeseHole)" />
        <circle cx="67" cy="41" r="1.6" fill="url(#cheeseHole)" />
        <circle cx="50" cy="51" r="1.5" fill="url(#cheeseHole)" />
        <g className="cheese-eyes">
          <ellipse cx="30" cy="39" rx="1.9" ry="2.5" fill="#1A1616" />
          <ellipse cx="42" cy="41" rx="1.9" ry="2.5" fill="#1A1616" />
          <circle cx="30.6" cy="38" r=".7" fill="#fff" />
          <circle cx="42.6" cy="40" r=".7" fill="#fff" />
        </g>
        <ellipse cx="25" cy="44" rx="3.2" ry="1.8" fill="#FF4F7B" opacity=".55" />
        <ellipse cx="47.5" cy="47" rx="3.2" ry="1.8" fill="#FF4F7B" opacity=".55" />
        <path d="M33.5 44 Q36.5 47 39.5 44.6" fill="none" stroke="#1A1616" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}
