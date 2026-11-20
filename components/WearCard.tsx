"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { figureHalf, lookImage, styleById, type Outfit, type Wears } from "@/lib/style";
import { setWearFor, wearFor, type TonightPlan } from "@/lib/style-client";
import s from "./StyleScreens.module.css";

// What to wear, where the plan is (founder, 20 Nov 2026: Style felt like a
// separate app): on Plan my evening, a place's details and Home. An idea
// from their own styles for exactly this plan (about ₹0.1, kept for the
// day), with the style's own small picture; See the look opens Style home on
// the same plan, where it's drawn. Nothing shows for someone without Style.
export default function WearCard({ plan, here, tile, fallback = null, className = "" }: { plan: TonightPlan; here?: boolean; tile?: boolean; fallback?: ReactNode; className?: string }) {
  const router = useRouter();
  const [idea, setIdea] = useState<{ outfit: Outfit; wears: Wears } | null>(null);
  const key = JSON.stringify(plan.stops);
  useEffect(() => {
    let live = true;
    wearFor(plan).then((r) => live && setIdea(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the same stops mean the same idea
  }, [key]);
  if (!idea) return fallback;
  const lens = styleById(idea.outfit.style);
  const half = lens ? figureHalf(lens, idea.wears) : "both";
  const open = () => {
    setWearFor(plan);
    router.push("/style");
  };
  return (
    <button type="button" className={`${s.vars} ${tile ? s.wearTile : s.wearCard} ${className}`} onClick={open}>
      <span className={s.wearPic}>
        {/* eslint-disable-next-line @next/next/no-img-element -- cropped to one figure */}
        <img src={lookImage(idea.outfit.style)} alt="" style={half === "right" ? { right: 0 } : half === "both" ? { left: "50%", transform: "translateX(-50%)" } : { left: 0 }} />
      </span>
      <span className={s.wearText}>
        <span className={s.wearKick}>{here ? "WHAT TO WEAR HERE" : "WHAT TO WEAR"}</span>
        <span className={s.wearTitle}>{idea.outfit.title}</span>
        {!tile && <span className={s.wearLine}>{idea.outfit.line}</span>}
        <span className={s.wearLink}>{tile ? `For ${plan.stops[0]?.name ?? "tonight"} ›` : "See the look ›"}</span>
      </span>
    </button>
  );
}
