"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/StyleParts";
import { lookImage, type Outfit, type Wears } from "@/lib/style";
import { drawLook, loadStyleProfile } from "@/lib/style-client";
import s from "./StyleScreens.module.css";

// What to wear, in Ask Feta (founder, 20 Nov 2026): the outfit drawn (on
// them when they added a photo in Style), its pieces, and brands for the
// look in their country. Opens Style for more.
export default function OutfitCard({ outfit, brands }: { outfit: Outfit; brands: { id: string; name: string; logo: string | null; homegrown: boolean }[] }) {
  const router = useRouter();
  const [look, setLook] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadStyleProfile()
      .then((p) => drawLook(outfit, (p?.wears ?? "women") as Wears))
      .then((img) => live && setLook(img));
    return () => {
      live = false;
    };
  }, [outfit]);
  return (
    <div className={`${s.vars} ${s.chatOutfit}`}>
      <div className={s.chatLook}>
        {/* eslint-disable-next-line @next/next/no-img-element -- drawn for them, kept on this phone */}
        <img src={look ?? lookImage(outfit.style)} alt={`${outfit.title}: ${outfit.pieces.top}, ${outfit.pieces.bottom}, ${outfit.pieces.shoes}`} style={{ opacity: look ? 1 : 0.35 }} />
        {!look && <span className={s.drawingWait} aria-hidden="true" />}
      </div>
      <div className={s.chatPieces}>
        <span className={s.kick}>WHAT TO WEAR</span>
        <span className={s.brandName}>{outfit.title}</span>
        <span className={s.small}>Top: {outfit.pieces.top}</span>
        <span className={s.small}>Bottom: {outfit.pieces.bottom}</span>
        <span className={s.small}>Shoes: {outfit.pieces.shoes}</span>
        {brands.length > 0 && (
          <span className={s.chatBrands}>
            {brands.map((b) => (
              <button key={b.id} type="button" onClick={() => router.push(`/style/brands?style=${outfit.style}`)} aria-label={b.name}>
                <Logo name={b.name} src={b.logo} />
              </button>
            ))}
          </span>
        )}
        <button type="button" className={s.link} style={{ alignSelf: "flex-start", fontSize: 13 }} onClick={() => router.push("/style")}>
          Open in Style ›
        </button>
      </div>
    </div>
  );
}
