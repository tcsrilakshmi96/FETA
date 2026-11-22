"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Mascot from "@/components/Mascot";
import { Line, Logo, vars } from "@/components/StyleParts";
import { styleById } from "@/lib/style";
import { loadLovedBrands, loadSavedBrands, loveBrand, toggleSavedBrand, type SavedBrand } from "@/lib/style-client";
import s from "./StyleScreens.module.css";

// Saved → Want to try → Brands (founder, 20 Nov 2026): brands saved in
// Style, hanging on a rail like clothes; each opens its own site.
const sag = (f: number) => 10 + 48 * f * (1 - f);

function Filter({ on, onChange }: { on: boolean; onChange: (brands: boolean) => void }) {
  return (
    <div className={s.chips} style={{ margin: "10px 0 4px" }}>
      {[false, true].map((b) => (
        <button key={String(b)} type="button" className={`${s.chip} ${on === b ? s.chipOn : ""}`} style={{ padding: "8px 16px", fontSize: 13 }} aria-pressed={on === b} onClick={() => onChange(b)}>
          {b ? "Brands" : "Places"}
        </button>
      ))}
    </div>
  );
}

function SavedBrands() {
  const router = useRouter();
  const [brands, setBrands] = useState<SavedBrand[] | null>(null);
  const [loved, setLoved] = useState<Set<string>>(new Set());
  useEffect(() => {
    loadSavedBrands().then(setBrands);
    loadLovedBrands().then((l) => setLoved(new Set(l.map((b) => b.id))));
  }, []);
  if (brands === null) return <p className={s.small}>Getting your brands…</p>;
  if (!brands.length)
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "30px 0", textAlign: "center" }}>
        <Mascot pose="wave" size={100} prop="shades" />
        <p className={s.sub}>Tap ♥ on a brand in Style and it hangs here.</p>
        <button type="button" className={s.chip} onClick={() => router.push("/style/brands")}>
          Find brands for your style
        </button>
      </div>
    );
  const rows = Math.ceil(brands.length / 2);
  return (
    <div className={s.vars} style={{ paddingTop: 4 }}>
      <Line height={rows * 230 + 20} rows={Array.from({ length: rows }, (_, r) => r * 230)}>
        {brands.map((b, i) => {
          const f = i % 2 ? 0.72 : 0.28;
          const remove = () => {
            setBrands(brands.filter((x) => x.id !== b.id));
            toggleSavedBrand({ id: b.id, style: b.style ?? "" }, false, b.country ?? "");
          };
          return (
            <div key={b.id} className={`${s.hang} ${s.hangSoft}`} style={vars({ left: `calc(${f * 100}% - 80px)`, top: Math.floor(i / 2) * 230 + sag(f) - 2, "--sway": `${3.4 + i * 0.3}s`, "--delay": `${i * 0.2}s` })}>
              <div className={`${s.hanger} ${s.dropIn}`} style={{ animationDelay: `${i * 0.1}s` }}>
                <span className={s.string} />
                <div className={s.note} style={{ width: 160, boxShadow: "0 8px 18px rgba(26,22,22,0.1)", gap: 6 }}>
                  <Logo name={b.name} src={b.logo} big />
                  <span className={s.brandName}>{b.name}</span>
                  <span className={s.small}>{[b.style && styleById(b.style)?.short, b.country && new Intl.DisplayNames(["en"], { type: "region" }).of(b.country)].filter(Boolean).join(" · ")}</span>
                  <span style={{ display: "flex", justifyContent: "space-between" }}>
                    {b.link ? (
                      <a className={s.link} href={b.link.href} target="_blank" rel="noopener noreferrer">
                        {b.link.label}
                      </a>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      className={s.small}
                      style={{ color: loved.has(b.id) ? "var(--roseText)" : undefined }}
                      aria-pressed={loved.has(b.id)}
                      onClick={() => {
                        const on = !loved.has(b.id);
                        const next = new Set(loved);
                        if (on) next.add(b.id);
                        else next.delete(b.id);
                        setLoved(next);
                        loveBrand(b.id, on, { country: b.country ?? undefined });
                      }}
                    >
                      {loved.has(b.id) ? "♥ Love it" : "Love it"}
                    </button>
                    <button type="button" className={s.small} onClick={remove} aria-label={`Remove ${b.name}`}>
                      Remove
                    </button>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </Line>
    </div>
  );
}

SavedBrands.Filter = Filter;
export default SavedBrands;
