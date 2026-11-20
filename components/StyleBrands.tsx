"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Figure, Logo, StyleTop, vars } from "@/components/StyleParts";
import TabBar from "@/components/TabBar";
import { loadOrigin } from "@/lib/origin";
import { fitsBudget, styleById } from "@/lib/style";
import { brandsFor, fromPhone, loadLovedBrands, rankForMe, researchCountry, loadStyleProfile, saveStyleProfile, savedBrandIds, toggleSavedBrand, type BrandCard, type StyleProfile } from "@/lib/style-client";
import s from "./StyleScreens.module.css";

// Brand discovery (founder, 20 Nov 2026): "if you like X style here, these
// brands exist", homegrown and international that sell in their country.
// "Homegrown only" lives here (founder: not in setup); international ones
// fall off the list. A heart saves a brand to Saved → Brands.
export default function StyleBrands() {
  const params = useSearchParams();
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [tab, setTab] = useState<string | null>(params.get("style"));
  const [all, setAll] = useState<BrandCard[] | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState(0);
  const [researching, setResearching] = useState<string | null>(null); // the style Feta is researching now
  const [drawn, setDrawn] = useState<Record<string, string>>({});
  const origin = typeof window === "undefined" ? null : loadOrigin();

  useEffect(() => {
    loadStyleProfile().then((p) => {
      if (!p || !origin) return;
      setProfile(p);
      setTab((t) => (t && p.styles.includes(t) ? t : p.styles[0]));
      // Ordered for them by Feta, with a line on why.
      const load = async () => {
        const [all, loved] = await Promise.all([brandsFor(p.styles, origin.city.country, p.wears), loadLovedBrands()]);
        setAll(await rankForMe(all, p, origin.city.countryName, loved.map((l) => l.name)));
      };
      load();
      researchCountry(origin.city.id, origin.city.country, p.styles, (style) => p.styles.includes(style) && load(), setResearching);
      if (p.onYou) Promise.all(p.styles.map(async (id) => [id, await fromPhone(`draw:${id}`)] as const)).then((x) => setDrawn(Object.fromEntries(x.filter(([, v]) => v)) as Record<string, string>));
    });
    savedBrandIds().then(setSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  if (!profile || !origin || !tab) return null;
  const home = profile.homegrownOnly;
  const lens = styleById(tab)!;
  const list = (all ?? []).filter((b) => b.style === tab);
  const shown = list.filter((b) => !home || b.homegrown).length;

  function toggleHome() {
    const p = { ...profile!, homegrownOnly: !home };
    setProfile(p);
    saveStyleProfile(p, origin!.city);
  }

  function heart(b: BrandCard) {
    const on = !saved.has(b.id);
    const next = new Set(saved);
    if (on) next.add(b.id);
    else next.delete(b.id);
    setSaved(next);
    if (on) setToast((t) => t + 1);
    toggleSavedBrand(b, on, origin!.city.country);
  }

  return (
    <>
      <main className={s.screen}>
        <div className={s.page}>
          <StyleTop back="/style" backLabel="Style" />
          <section className={s.stage} style={{ height: 210 }}>
            <div key={`m-${tab}`} className={s.marquee} style={{ top: 30 }} aria-hidden="true">
              {`${lens.big} · `.repeat(6)}
            </div>
            <Figure key={`f-${tab}`} style={tab} wears={profile.wears} drawn={drawn[tab]} height={200} pos={{ left: "auto", right: 18, marginLeft: 0 }} />
            <div style={{ position: "absolute", left: 16, bottom: 14, display: "flex", flexDirection: "column", gap: 2, zIndex: 3 }}>
              <span className={s.styleName}>{lens.name}</span>
              <span style={{ fontSize: 12.5, opacity: 0.75 }}>
                {all === null ? "Finding brands…" : `${shown} brand${shown === 1 ? "" : "s"} that sell in ${origin.city.countryName}`}
              </span>
            </div>
          </section>

          <div className={s.chips}>
            {profile.styles.map((id) => (
              <button key={id} type="button" className={`${s.chip} ${tab === id ? s.chipOn : ""}`} style={{ padding: "8px 14px", fontSize: 13 }} aria-pressed={tab === id} onClick={() => setTab(id)}>
                {styleById(id)?.short}
              </button>
            ))}
          </div>

          <button type="button" className={`${s.switch} ${home ? s.switchOn : ""}`} aria-pressed={home} onClick={toggleHome}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Homegrown only</span>
              <span style={{ fontSize: 12, opacity: 0.75 }}>{home ? `Only labels started in ${origin.city.countryName}` : `Off: ${origin.city.countryName} labels and international ones that sell here`}</span>
            </span>
            <span className={s.track}>
              <span className={s.knob} />
            </span>
          </button>

          <div key={`list-${tab}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {researching === tab && (
              <p className={s.researching}>
                <span aria-hidden="true" /> Feta is looking for more {lens.short.toLowerCase()} brands in {origin.city.countryName} now. New ones appear here in a couple of minutes.
              </p>
            )}
            {all !== null && list.length === 0 && researching !== tab && <p className={s.small}>No {lens.short.toLowerCase()} brands for {origin.city.countryName} in Feta&apos;s library yet. Feta will look for some.</p>}
            {list.map((b, i) => {
              const fit = fitsBudget(b.priceFeel, profile.budget);
              return (
                <div key={b.id} className={`${s.leaving} ${home && !b.homegrown ? s.gone : ""}`}>
                  <div className={s.brandCard} style={vars({ "--delay": `${i * 0.06}s` })}>
                    <Logo name={b.name} src={b.logo} big />
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className={s.brandName}>{b.name}</span>
                        <span className={`${s.badge} ${b.homegrown ? s.badgeHome : ""}`}>{b.homegrown ? "HOMEGROWN" : "INTERNATIONAL"}</span>
                        {b.fetaPick ? <span className={`${s.badge} ${s.badgePick}`}>★ FETA PICK</span> : !b.approved && <span className={s.badge}>NEW FIND</span>}
                      </div>
                      {b.fetaPick && b.note && <span className={s.pickNote}>&ldquo;{b.note}&rdquo;</span>}
                      {(b.youLove || !!b.lovers) && (
                        <span className={s.small} style={{ color: "var(--roseText)" }}>
                          {b.youLove ? "♥ You love this" : `♥ Loved by ${b.lovers} Feta user${b.lovers === 1 ? "" : "s"}`}
                        </span>
                      )}
                      {b.forYou && <span className={s.forYou}>{b.forYou}</span>}
                      <span className={s.small} style={{ color: "rgba(var(--inkRGB),0.75)" }}>{b.why}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {fit === true && <span className={s.fits}>✓ In your budget</span>}
                        {fit === false && <span className={s.small}>Mostly above your budget</span>}
                        {b.website && (
                          <a className={s.link} href={b.website} target="_blank" rel="noopener noreferrer">
                            Visit site ↗
                          </a>
                        )}
                      </div>
                    </div>
                    <button type="button" className={`${s.heart} ${saved.has(b.id) ? s.hearted : ""}`} aria-label={`Save ${b.name}`} aria-pressed={saved.has(b.id)} onClick={() => heart(b)}>
                      ♥
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
      {toast > 0 && (
        <a key={toast} href="/lists?show=brands" className={s.toast}>
          ♥ Saved to Saved → Brands
        </a>
      )}
      <TabBar active="style" />
    </>
  );
}
