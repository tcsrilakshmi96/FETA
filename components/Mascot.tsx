import { useId, type ReactNode } from "react";
import styles from "./Mascot.module.css";

// Feta's cheese (founder, 18 Nov 2026; mock-up "Feta's Cheese",
// https://claude.ai/artifact/9QEDvVspmBzxqwhfdRTQpZ): one character with
// arms and legs, a few moods and some cheese tricks, each kept for one kind
// of moment so people learn what it means. Never on pick cards, place photos
// or Style looks; mould only ever on the cheese (it means "this is old",
// never "this place is bad").
export type Pose =
  | "idle" // standing by (Ask, tab, quiet places)
  | "wave" // hello: welcome, the questions
  | "walk" // looking around: while Feta finds picks or plans
  | "cheer" // yay: plan saved, a friend is in, Loved it
  | "think" // hmm: Choose for me, How was it?
  | "sorry" // nothing fits
  | "sleep" // late at night
  | "stretch" // stringy pull: a fresh set
  | "slice" // share a slice: sent to friends
  | "mould" // old picks, old saves
  | "melt" // something went wrong
  | "bite" // been there
  | "aged" // a month with Feta
  | "fresh"; // mould shaken off
export type Prop = "fork" | "ticket" | "shades" | "suitcase" | "lens";

type Arms = "down" | "wave" | "up" | "hold";
type Eyes = "open" | "happy" | "sleepy" | "sorry" | "look";
type Mouth = "smile" | "grin" | "sorry" | "o" | "sleepy" | "chew";

const LOOK: Record<Pose, { eyes: Eyes; mouth: Mouth; arms: Arms; prop?: Prop }> = {
  idle: { eyes: "open", mouth: "smile", arms: "down" },
  wave: { eyes: "open", mouth: "grin", arms: "wave" },
  walk: { eyes: "open", mouth: "smile", arms: "hold", prop: "lens" },
  cheer: { eyes: "happy", mouth: "grin", arms: "up" },
  think: { eyes: "look", mouth: "o", arms: "down" },
  sorry: { eyes: "sorry", mouth: "sorry", arms: "down" },
  sleep: { eyes: "sleepy", mouth: "sleepy", arms: "down" },
  stretch: { eyes: "happy", mouth: "grin", arms: "down" },
  slice: { eyes: "open", mouth: "grin", arms: "down" },
  mould: { eyes: "sorry", mouth: "sorry", arms: "down" },
  melt: { eyes: "sorry", mouth: "o", arms: "down" },
  bite: { eyes: "happy", mouth: "chew", arms: "down" },
  aged: { eyes: "open", mouth: "smile", arms: "down" },
  fresh: { eyes: "happy", mouth: "grin", arms: "up" },
};

const ARMS: Record<Arms, [string, [number, number], string, [number, number]]> = {
  down: ["M21 72 Q12 79 13 88", [13, 88], "M100 72 Q109 79 108 88", [108, 88]],
  wave: ["M21 72 Q12 79 13 88", [13, 88], "M100 71 Q111 62 109 49", [109, 49]],
  up: ["M21 71 Q10 62 12 49", [12, 49], "M100 71 Q111 62 109 49", [109, 49]],
  hold: ["M21 72 Q12 79 13 88", [13, 88], "M100 74 Q109 79 113 73", [113, 73]],
};

const INK = "#1a1616";
const LIMB = "#e08c00";
const TOP = "#FFD94A";
const FRONT = "#FFB81E";
const HOLE = "#E89206";
const STAR = "M0 -5 L1.3 -1.3 L5 0 L1.3 1.3 L0 5 L-1.3 1.3 L-5 0 L-1.3 -1.3Z";
const line = { fill: "none", stroke: INK, strokeWidth: 2.2, strokeLinecap: "round" } as const;
const limb = { fill: "none", stroke: LIMB, strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function EyesOf({ kind }: { kind: Eyes }) {
  const dots = (dx = 0, dy = 0) => (
    <g className={styles.eyes}>
      <g className={styles.pupils}>
        <ellipse cx={50 + dx} cy={70 + dy} rx="2.7" ry="3.5" fill={INK} />
        <ellipse cx={70 + dx} cy={71 + dy} rx="2.7" ry="3.5" fill={INK} />
        <circle cx={51 + dx} cy={68.6 + dy} r="1" fill="#fff" />
        <circle cx={71 + dx} cy={69.6 + dy} r="1" fill="#fff" />
      </g>
    </g>
  );
  if (kind === "happy")
    return (
      <>
        <path d="M46.5 71 Q50 66.5 53.5 71" {...line} />
        <path d="M66.5 72 Q70 67.5 73.5 72" {...line} />
      </>
    );
  if (kind === "sleepy")
    return (
      <>
        <path d="M46.5 70 Q50 73 53.5 70" {...line} />
        <path d="M66.5 71 Q70 74 73.5 71" {...line} />
      </>
    );
  if (kind === "sorry")
    return (
      <>
        {dots(0, 1)}
        <path d="M45.5 64.5 L53 62" {...line} />
        <path d="M74.5 65.5 L67 63" {...line} />
      </>
    );
  if (kind === "look") return dots(1.5, -1.5);
  return dots();
}

function MouthOf({ kind }: { kind: Mouth }) {
  const stroke = { ...line, strokeWidth: 2 };
  if (kind === "grin")
    return (
      <>
        <path d="M54.5 76 Q60 84.5 65.5 76 Z" fill={INK} />
        <path d="M57 80.6 Q60 79 63 80.6 Q60 82.6 57 80.6Z" fill="#ff4f7b" />
      </>
    );
  if (kind === "sorry") return <path d="M56 81 Q60 77.5 64 81" {...stroke} />;
  if (kind === "o") return <ellipse cx="60" cy="79" rx="2" ry="2.4" fill={INK} />;
  if (kind === "sleepy") return <path d="M57.5 79 h5" {...stroke} />;
  if (kind === "chew")
    return (
      <g className={styles.chew}>
        <path d="M55 77 Q60 82 65 77 Q60 79 55 77Z" fill={INK} />
      </g>
    );
  return <path d="M55.5 77 Q60 81.5 64.5 77" {...stroke} />;
}

function HandProp({ prop }: { prop?: Prop }) {
  if (prop === "lens")
    return (
      <g>
        <line x1="113" y1="73" x2="116.5" y2="68" stroke={LIMB} strokeWidth="3" strokeLinecap="round" />
        <circle cx="120" cy="62" r="7" fill="rgba(43,196,201,.25)" stroke={LIMB} strokeWidth="2.6" />
        <path d="M116.5 59 Q118 57.5 120 57.5" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </g>
    );
  if (prop === "fork")
    return (
      <g stroke="#9aa3ab" strokeWidth="2.4" strokeLinecap="round" fill="none">
        <path d="M114 76 L117 50" />
        <path d="M113 50 L114.5 40 M117.5 50 L118 40 M121 50.5 L121.5 41" />
        <path d="M113 50 Q117 54 121 50.5" />
      </g>
    );
  if (prop === "ticket")
    return (
      <g transform="rotate(-18 120 66)">
        <path d="M108 58 h24 v5 a3 3 0 0 0 0 6 v5 h-24 v-5 a3 3 0 0 0 0 -6 Z" fill="#ff4f7b" />
        <path d="M114 60 v12" stroke="#fff" strokeWidth="1" strokeDasharray="2 2" />
      </g>
    );
  return null;
}

// Mozzarella strings across a gap, from x0 to x1.
function Strings({ x0, x1, ys }: { x0: number; x1: number; ys: number[] }) {
  return (
    <g className={styles.strings}>
      {ys.map((y, i) => (
        <path
          key={y}
          d={`M${x0} ${y} Q${(x0 + x1) / 2} ${y + 3 + (i % 2) * 2} ${x1} ${y}`}
          stroke={i % 2 ? "#FFC93A" : "#FFDD5C"}
          strokeWidth={2.6 - (i % 3) * 0.5}
          strokeLinecap="round"
          fill="none"
        />
      ))}
    </g>
  );
}

export default function Mascot({
  pose = "idle",
  size = 120,
  prop,
  limbs = size >= 48,
  pop = false,
  className = "",
}: {
  pose?: Pose;
  size?: number;
  prop?: Prop;
  /** Arms and legs; left off at icon size, where only the face reads. */
  limbs?: boolean;
  /** Pops in from a dot and lands with a squash. */
  pop?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const look = LOOK[pose];
  const held = prop ?? look.prop;
  const arms = held && held !== "shades" && held !== "suitcase" && look.arms === "down" ? "hold" : look.arms;
  const [lp, lh, rp, rh] = ARMS[arms];

  const back = limbs && (
    <>
      <g className={styles.legL}>
        <path d="M42 92 L41 106 L35 106" {...limb} />
      </g>
      <g className={styles.legR}>
        <path d="M78 92 L79 106 L85 106" {...limb} />
      </g>
      <g className={styles.armL}>
        <path d={lp} {...limb} />
        <circle cx={lh[0]} cy={lh[1]} r="3.4" fill={LIMB} />
      </g>
      {held === "suitcase" && (
        <g>
          <path d="M108 86 v-5 q0 -2 2 -2 h6 q2 0 2 2 v5" fill="none" stroke={LIMB} strokeWidth="2" />
          <rect x="102" y="86" width="22" height="18" rx="4" fill="#2bc4c9" />
          <path d="M108 86 v18 M118 86 v18" stroke="rgba(0,0,0,.18)" strokeWidth="2" />
        </g>
      )}
    </>
  );

  let body: ReactNode = (
    <>
      <path d="M20 54 L102 58 L100 86 Q99 92 93 92 L27 94 Q20 94 20 88 Z" fill={FRONT} stroke={FRONT} strokeWidth="5" strokeLinejoin="round" />
      <path d="M20 54 L60 32 Q65 29 70 32 L102 58 Z" fill={TOP} stroke={TOP} strokeWidth="5" strokeLinejoin="round" />
      <ellipse cx="64" cy="45" rx="7" ry="3" fill={HOLE} />
      <ellipse cx="44" cy="50" rx="3" ry="1.4" fill="#FFE98A" />
      <circle cx="30" cy="83" r="4" fill={HOLE} />
      <circle cx="90" cy="83" r="3" fill={HOLE} />
      <circle cx="94" cy="69" r="1.8" fill={HOLE} />
      <ellipse cx="42" cy="77.5" rx="4" ry="2.2" fill="#ff4f7b" opacity=".5" />
      <ellipse cx="78" cy="78.5" rx="4" ry="2.2" fill="#ff4f7b" opacity=".5" />
      {pose === "mould" && (
        <>
          {[
            [34, 64],
            [86, 72],
            [58, 40],
            [76, 89],
            [28, 87],
          ].map(([x, y], i) => (
            <g key={i} className={styles.spot} style={{ animationDelay: `${i * 0.35}s` }}>
              <circle cx={x} cy={y} r="4.4" fill="#8db36b" />
              <circle cx={x + 3.2} cy={y - 2} r="3" fill="#a9c98a" />
              <circle cx={x - 2.8} cy={y + 2} r="2.7" fill="#6f9a7e" />
              <circle cx={x + 1} cy={y + 3.2} r="1.6" fill="#cfe3b5" />
            </g>
          ))}
          <path d="M81 59 q2.4 3.4 0 5 q-2.4 -1.6 0 -5Z" fill="#7fc8f0" />
        </>
      )}
      {held === "shades" ? (
        <g>
          <rect x="43" y="65" width="14" height="9" rx="4" fill={INK} />
          <rect x="63" y="66" width="14" height="9" rx="4" fill={INK} />
          <path d="M57 69 Q60 67.5 63 70" stroke={INK} strokeWidth="1.8" fill="none" />
        </g>
      ) : (
        <EyesOf kind={look.eyes} />
      )}
      <MouthOf kind={held === "shades" ? "grin" : look.mouth} />
      {pose === "aged" && (
        <g>
          <path d="M45.5 63 Q50 60 54.5 62.5" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="70" cy="71" r="6.5" fill="rgba(255,255,255,.25)" stroke="#b8902a" strokeWidth="1.6" />
          <path className={styles.glint} d="M66.5 68 l2.5 -2.5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M76 74 Q80 84 83 85" stroke="#b8902a" strokeWidth="1" fill="none" />
          <circle cx="88" cy="86" r="7" fill="#c8283f" />
          <text x="88" y="88.3" fontSize="6.2" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="var(--font-outfit), sans-serif">
            30
          </text>
        </g>
      )}
    </>
  );
  if (pose === "bite") body = <g mask={`url(#bite${id})`}>{body}</g>;

  const fore = (
    <>
      {limbs && (
        <g className={styles.armR}>
          <path d={rp} {...limb} />
          <HandProp prop={held} />
          <circle cx={rh[0]} cy={rh[1]} r="3.4" fill={LIMB} />
        </g>
      )}
      {pose === "cheer" &&
        (
          [
            [14, 34, "#ff4f7b"],
            [106, 30, "#2bc4c9"],
            [32, 24, "#ffb020"],
            [92, 22, "#ff4f7b"],
            [62, 16, "#2bc4c9"],
          ] as const
        ).map(([x, y, c], i) => (
          <rect key={i} className={styles.crumb} x={x} y={y} width="5" height="5" rx="1.5" fill={c} transform={`rotate(${i * 25} ${x + 2} ${y + 2})`} style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      {pose === "fresh" &&
        (
          [
            [12, 40, 1],
            [108, 34, 0.8],
            [30, 20, 0.7],
            [92, 18, 1.1],
          ] as const
        ).map(([x, y, s], i) => (
          <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
            <path className={styles.twinkle} d={STAR} fill="#ffb020" style={{ animationDelay: `${i * 0.2}s` }} />
          </g>
        ))}
      {pose === "sleep" && (
        <g fontWeight="700" fill="var(--ink)" fontFamily="var(--font-fraunces), serif">
          <text className={styles.zz} x="92" y="44" fontSize="10">
            z
          </text>
          <text className={`${styles.zz} ${styles.zz2}`} x="100" y="36" fontSize="8">
            z
          </text>
          <text className={`${styles.zz} ${styles.zz3}`} x="106" y="28" fontSize="6">
            z
          </text>
        </g>
      )}
    </>
  );

  const inner = (
    <>
      {back}
      {body}
      {fore}
    </>
  );

  let content: ReactNode = <g className={styles.bod}>{inner}</g>;
  if (pose === "stretch")
    content = (
      <g className={styles.bod}>
        <Strings x0={47} x1={73} ys={[42, 52, 62, 72, 82, 90]} />
        <g className={styles.halfL} clipPath={`url(#L${id})`}>
          {inner}
        </g>
        <g className={styles.halfR} clipPath={`url(#R${id})`}>
          {inner}
        </g>
      </g>
    );
  if (pose === "slice")
    content = (
      <g className={styles.bod}>
        <Strings x0={86} x1={100} ys={[52, 62, 72, 82, 89]} />
        <g clipPath={`url(#M${id})`}>{inner}</g>
        <g className={styles.piece}>
          <g clipPath={`url(#P${id})`}>{inner}</g>
        </g>
      </g>
    );

  return (
    <svg
      className={`${styles.cz} ${styles[pose]} ${pop ? styles.pop : ""} ${className}`}
      viewBox={limbs ? "-4 12 136 104" : "16 26 90 72"}
      width={size}
      height={limbs ? (size * 104) / 136 : (size * 72) / 90}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={`L${id}`}>
          <rect x="-20" y="0" width="80" height="140" />
        </clipPath>
        <clipPath id={`R${id}`}>
          <rect x="60" y="0" width="90" height="140" />
        </clipPath>
        <clipPath id={`M${id}`}>
          <rect x="-20" y="0" width="106" height="140" />
        </clipPath>
        <clipPath id={`P${id}`}>
          <rect x="86" y="0" width="60" height="140" />
        </clipPath>
        {pose === "bite" && (
          <mask id={`bite${id}`} maskUnits="userSpaceOnUse" x="-20" y="0" width="170" height="140">
            <rect x="-20" y="0" width="170" height="140" fill="#fff" />
            <g className={styles.marks}>
              <circle cx="103" cy="57" r="8.5" />
              <circle cx="95.5" cy="50.5" r="5.5" />
              <circle cx="104.5" cy="67" r="5.5" />
            </g>
          </mask>
        )}
      </defs>
      {limbs && <ellipse className={styles.shadow} cx="60" cy="110" rx="30" ry="4" fill="rgba(var(--inkRGB), .12)" />}
      {pose === "melt" && (
        <g>
          <ellipse className={styles.puddle} cx="60" cy="105" rx="40" ry="5" fill={FRONT} />
          {[
            [30, 13, 0],
            [50, 9, 0.2],
            [70, 15, 0.1],
            [88, 10, 0.3],
          ].map(([x, h, d]) => (
            <rect key={x} className={styles.drip} x={x} y="92" width="5.5" height={h} rx="2.75" fill={FRONT} style={{ animationDelay: `${d}s` }} />
          ))}
        </g>
      )}
      {content}
      {pose === "bite" &&
        [
          [100, 60],
          [106, 64],
          [97, 56],
        ].map(([x, y], i) => <rect key={i} className={styles.fall} x={x} y={y} width="3.4" height="3.4" rx="1" fill={FRONT} style={{ animationDelay: `${i * 0.12}s` }} />)}
      {pose === "mould" && (
        <>
          <g className={styles.fly}>
            <ellipse cx="60" cy="17" rx="2.6" ry="2" fill="var(--ink)" />
            <ellipse className={styles.wing} cx="58.3" cy="14.6" rx="2.2" ry="1.2" fill="rgba(150,185,205,.85)" />
            <ellipse className={styles.wing} cx="61.7" cy="14.6" rx="2.2" ry="1.2" fill="rgba(150,185,205,.85)" />
          </g>
          {[38, 66, 92].map((x, i) => (
            <path key={x} className={styles.stink} d={`M${x} 30 q-3 -4 0 -8 q3 -4 0 -8`} stroke="#8db36b" strokeWidth="1.8" fill="none" strokeLinecap="round" style={{ animationDelay: `${i * 0.6}s` }} />
          ))}
        </>
      )}
    </svg>
  );
}

/** The cheese with a speech bubble under it, like the questions in the mock-up. */
export function MascotSays({ pose, size = 120, prop, pop, children }: { pose: Pose; size?: number; prop?: Prop; pop?: boolean; children: ReactNode }) {
  return (
    <div className={styles.says}>
      <Mascot pose={pose} size={size} prop={prop} pop={pop} />
      <p className={styles.bubble}>{children}</p>
    </div>
  );
}
