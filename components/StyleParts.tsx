"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import FetaPicksSheet from "@/components/FetaPicksSheet";
import FetaStar from "@/components/FetaStar";
import { loadOrigin, type Origin } from "@/lib/origin";
import { loadName } from "@/lib/profile";
import { figureHalf, lookImage, styleById, type Wears } from "@/lib/style";
import s from "./StyleScreens.module.css";

export const vars = (v: Record<string, string | number>) => v as CSSProperties;

// The top of Style home and brands, like Home's: the date and STYLE (with a
// small BETA tag), or a way back, and the same ★ Feta Picks and You buttons.
export function StyleTop({ back, backLabel = "Home", right }: { back?: string | (() => void); backLabel?: string; right?: ReactNode }) {
  const router = useRouter();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [name, setName] = useState("");
  const [fetaOpen, setFetaOpen] = useState(false);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- read from the phone */
    setOrigin(loadOrigin());
    setName(loadName());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  return (
    <>
      <div className={s.top}>
        {back ? (
          <button type="button" className={s.back} onClick={() => (typeof back === "string" ? router.push(back) : back())}>
            ‹ {backLabel}
          </button>
        ) : (
          <span>
            {new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date()).toUpperCase().replace(",", "")} · STYLE
            <span className={s.betaTag}>BETA</span>
          </span>
        )}
        {right ?? (
          <span className={s.buttons}>
            {origin && <FetaStar cityId={origin.city.id} cityName={origin.city.name} onOpen={() => setFetaOpen(true)} />}
            <button type="button" className={s.acct} onClick={() => router.push("/you")} aria-label="You: your preferences and account">
              {name ? name[0].toUpperCase() : "◯"}
            </button>
          </span>
        )}
      </div>
      {fetaOpen && origin && <FetaPicksSheet origin={origin} when="tonight" onClose={() => setFetaOpen(false)} />}
    </>
  );
}

// One figure in a style: their drawing when they added a photo, else the
// woman, the man or both from Feta's illustration, by what they shop for.
// Dots on the clothes open a label each.
export type Spots = { top: string; bottom: string; shoes: string };

export function Figure({ style, wears, drawn, height, spots, leaving, className, label, pos }: { style: string; wears: Wears; drawn?: string | null; height: number; spots?: Spots | null; leaving?: boolean; className?: string; label?: string; pos?: CSSProperties }) {
  const lens = styleById(style);
  const [open, setOpen] = useState<keyof Spots | null>("top");
  if (!lens) return null;
  const half = drawn ? "drawn" : figureHalf(lens, wears);
  const width = drawn ? Math.round((height * 9) / 16) : half === "both" ? height : Math.round(height / 2);
  const alt = label ?? `${lens.name}: illustrated outfit`;
  // Where each piece sits on a standing figure.
  const at: Record<keyof Spots, [number, number, number]> = { top: [0.5, 0.32, -0.55], bottom: [0.47, 0.6, -0.6], shoes: [0.52, 0.93, -0.7] };
  return (
    <div className={`${s.figure} ${leaving ? s.figureOut : ""} ${className ?? ""}`} style={{ width, height, left: "50%", marginLeft: -width / 2, bottom: 0, ...pos }}>
      {drawn ? (
        <div className={s.drawing}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a drawing kept on this phone */}
          <img src={drawn} alt={alt} />
        </div>
      ) : (
        <div className={s.bob}>
          {/* eslint-disable-next-line @next/next/no-img-element -- cropped to one figure */}
          <img src={lookImage(lens.id)} alt={alt} style={{ height, width: height, left: half === "right" ? -width : 0 }} />
        </div>
      )}
      {spots &&
        (Object.keys(at) as (keyof Spots)[]).map((k, i) =>
          spots[k] ? (
            <span key={k}>
              <button type="button" className={s.spot} style={vars({ left: at[k][0] * width, top: at[k][1] * height, "--delay": `${i * 0.4}s` })} aria-label={spots[k]} aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} />
              {open === k && (
                <span className={s.spotLabel} style={{ left: Math.max(-90, at[k][2] * width), top: at[k][1] * height - 44 }}>
                  {spots[k]}
                </span>
              )}
            </span>
          ) : null,
        )}
    </div>
  );
}

// Things hanging on a line: a curved rope and items that sway.
export function Line({ height, rows = [0], children }: { height: number; rows?: number[]; children: ReactNode }) {
  return (
    <div className={s.line} style={{ height }}>
      <svg className={s.rope} height={height} viewBox={`0 0 400 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {rows.map((y) => (
          <path key={y} d={`M -10 ${y + 10} Q 200 ${y + 34} 410 ${y + 10}`} stroke="var(--rope)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {children}
    </div>
  );
}

// Brand logo from its own site, else its first letter.
export function Logo({ name, src, big }: { name: string; src: string | null; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`${s.logo} ${big ? s.logoBig : ""}`} aria-hidden="true">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- the brand's own logo, from its site
        <img src={src} alt="" onError={() => setBroken(true)} />
      ) : (
        name.replace(/^the /i, "").slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
