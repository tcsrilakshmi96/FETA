"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { StyleFigure } from "@/components/StyleKit";
import { cityDay, keptPicture, loadStyleProfile, lookForPlan, setWearFor, wornOn, type LookSet, type TonightPlan } from "@/lib/style-client";
import type { Wears } from "@/lib/style";
import s from "./StyleScreens.module.css";

// What to wear, where the plan is (founder, 20–23 Nov 2026): on Plan my
// evening, a place's details and Home's Style tile. Once they've chosen a
// look today it shows "✓ You're wearing" with it (on the plan it was for,
// and on Home); before that, "What to wear", which opens Style on this plan.
// No AI is spent just to show it. Nothing shows for someone without Style.
export const FROM_KEY = "feta.style.from";
export default function WearCard({ plan, here, tile, big, fallback = null, className = "" }: { plan: TonightPlan | null; here?: boolean; tile?: boolean; big?: boolean; fallback?: ReactNode; className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ wears: Wears; first: string; worn: LookSet | null; pic: string | null } | null>(null);
  const key = plan ? lookForPlan(plan).key : "";
  useEffect(() => {
    let live = true;
    (async () => {
      const p = await loadStyleProfile();
      if (!p?.styles.length) return;
      const worn = await wornOn(cityDay());
      // On a plan, only the look chosen for that plan; Home shows today's.
      const mine = worn && worn.chosen !== null && (tile || worn.forKey === key) ? worn : null;
      const pic = mine ? await keptPicture(mine.looks[mine.chosen!]) : null;
      if (live) setState({ wears: p.wears, first: p.styles[0], worn: mine, pic });
    })();
    return () => {
      live = false;
    };
  }, [key, tile]);
  if (!state) return fallback;
  if (!plan && !state.worn) return fallback;
  const look = state.worn ? state.worn.looks[state.worn.chosen!] : null;
  const open = () => {
    try {
      if (plan && !state.worn) {
        setWearFor(plan);
        sessionStorage.setItem(FROM_KEY, here ? "place" : "plan");
      } else if (!tile) sessionStorage.setItem(FROM_KEY, here ? "place" : "plan");
      else sessionStorage.removeItem(FROM_KEY);
    } catch {
      // Style opens from Home.
    }
    router.push("/style");
  };
  return (
    <button type="button" className={`${s.vars} ${tile ? s.wearTile : s.wearCard} ${className}`} onClick={open}>
      <span className={s.wearPic} style={big ? { width: "44%", height: "88%", right: 14, bottom: 14, borderRadius: 18, background: "#dcdbd7" } : undefined}>
        {state.pic ? (
          // eslint-disable-next-line @next/next/no-img-element -- kept on this phone
          <img src={state.pic} alt="" style={{ inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
        ) : (
          <StyleFigure style={look?.style ?? state.first} wears={state.wears} />
        )}
      </span>
      <span className={s.wearText}>
        <span className={s.wearKick}>{look ? "✓ YOU'RE WEARING" : here ? "WHAT TO WEAR HERE" : "WHAT TO WEAR"}</span>
        <span className={s.wearTitle}>{look ? look.title : plan ? `For ${plan.stops[0]?.name ?? "tonight"}` : "Today"}</span>
        {!tile && look && <span className={s.wearLine}>{look.pieces.map((x) => x.name).join(" · ")}</span>}
        {!tile && !look && <span className={s.wearLine}>3 looks from your styles, made for this plan.</span>}
        <span className={s.wearLink}>{look ? "See it, or pick another ›" : "See the looks ›"}</span>
      </span>
    </button>
  );
}
