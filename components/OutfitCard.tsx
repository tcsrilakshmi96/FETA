"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLookPicture } from "@/components/StyleKit";
import { Logo } from "@/components/StyleParts";
import { SLOT_NAME, stylePicture, type Look, type Wears } from "@/lib/style";
import { loadStyleProfile } from "@/lib/style-client";
import s from "./StyleScreens.module.css";

// What to wear, in Ask Feta (founder, 20–23 Nov 2026): one complete look
// from their styles, its own picture when one was made (else the style's
// library picture, said so; made only on a tap in Style, 24 Nov 2026), its
// pieces, and brands for the look in their country.
// Opens Style for more.
export default function OutfitCard({ outfit, brands }: { outfit: Look; brands: { id: string; name: string; logo: string | null; homegrown: boolean }[] }) {
  const router = useRouter();
  const [wears, setWears] = useState<Wears | null>(null);
  useEffect(() => {
    let live = true;
    loadStyleProfile().then((p) => live && setWears(p?.wears ?? "women"));
    return () => {
      live = false;
    };
  }, []);
  const { pic: look } = useLookPicture(wears ? outfit : null, wears ?? "women", false);
  return (
    <div className={`${s.vars} ${s.chatOutfit}`}>
      <div className={s.chatLook}>
        {/* eslint-disable-next-line @next/next/no-img-element -- drawn for them, kept on this phone */}
        <img src={look ?? stylePicture(outfit.style, wears ?? "women", outfit.id)} alt={`${outfit.title}: ${outfit.pieces.map((p) => p.name).join(", ")}`}  />
        {!look && <span className={s.small} style={{ position: "absolute", left: 8, bottom: 6, background: "rgba(255,255,255,.85)", color: "#1c1714", borderRadius: 999, padding: "2px 7px", fontSize: 9.5, whiteSpace: "nowrap" }}>A look in this style</span>}
      </div>
      <div className={s.chatPieces}>
        <span className={s.kick}>WHAT TO WEAR</span>
        <span className={s.brandName}>{outfit.title}</span>
        {outfit.pieces.map((p, i) => (
          <span key={i} className={s.small}>
            {SLOT_NAME[p.slot].charAt(0) + SLOT_NAME[p.slot].slice(1).toLowerCase()}: {p.name}
          </span>
        ))}
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
