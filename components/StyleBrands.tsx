"use client";

import { useEffect, useRef, useState } from "react";
import { Figure, Logo, StyleTop, vars } from "@/components/StyleParts";
import TabBar from "@/components/TabBar";
import { loadOrigin } from "@/lib/origin";
import { STYLES, fitsBudget, styleById } from "@/lib/style";
import { brandTags, brandsFor, findMoreBrands, setTagVote, fromPhone, loadLovedBrands, rankForMe, researchCountry, loadStyleProfile, saveStyleProfile, savedBrandIds, toggleSavedBrand, type BrandCard, type StyleProfile } from "@/lib/style-client";
import s from "./StyleScreens.module.css";

// Brand discovery (founder, 20 Nov 2026): "if you like X style here, these
// brands exist", homegrown and international that sell in their country.
// "Homegrown only" lives here (founder: not in setup); international ones
// fall off the list. A heart saves a brand to Saved → Brands.
export default function StyleBrands() {
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [all, setAll] = useState<BrandCard[] | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState(0);
  const [researching, setResearching] = useState<string[]>([]); // styles Feta is researching now
  const [moreNote, setMoreNote] = useState<string | null>(null);
  const reload = useRef<() => Promise<unknown>>(async () => null);
  const [tagsFor, setTagsFor] = useState<{ id: string; tags: string[]; mine: Record<string, 1 | -1> } | null>(null);
  const [drawn, setDrawn] = useState<Record<string, string>>({});
  const [origin] = useState(() => (typeof window === "undefined" ? null : loadOrigin()));

  useEffect(() => {
    loadStyleProfile().then((p) => {
      if (!p || !origin) return;
      setProfile(p);
      const asked = new URLSearchParams(window.location.search).get("style");
      setTab(asked && p.styles.includes(asked) ? asked : p.styles[0]);
      // Ordered for them by Feta, with a line on why.
      const load = async () => {
        const [all, loved] = await Promise.all([brandsFor(p.styles, origin.city.country, p.wears, p.budget), loadLovedBrands()]);
        // Shown straight away, then reordered for them when Feta's ranking arrives.
        setAll(all);
        setAll(await rankForMe(all, p, origin.city.countryName, loved.map((l) => l.name)));
        return all;
      };
      reload.current = load;
      load().then((all) => researchCountry(origin.city.id, origin.city.country, p.styles.map((style) => ({ style, brands: all.filter((b) => b.style === style).length })), () => load(), setResearching));
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

  // Their own style tags on a brand (founder, 20 Nov 2026).
  async function openTags(id: string) {
    if (tagsFor?.id === id) {
      setTagsFor(null);
      reload.current();
      return;
    }
    const t = await brandTags(id);
    setTagsFor({ id, ...t });
  }

  async function toggleTag(id: string, style: string, on: boolean) {
    if (!tagsFor) return;
    const mine = tagsFor.mine[style];
    // Off → add (or undo their removal); on → remove (or undo their addition).
    const vote = on ? (mine === 1 ? null : -1) : mine === -1 ? null : 1;
    const nextMine = { ...tagsFor.mine };
    if (vote === null) delete nextMine[style];
    else nextMine[style] = vote;
    setTagsFor({ id, mine: nextMine, tags: on ? tagsFor.tags.filter((x) => x !== style) : [...tagsFor.tags, style] });
    await setTagVote(id, style, vote);
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
            {researching.includes(tab) && (
              <p className={s.researching}>
                <span aria-hidden="true" /> Feta is looking for more {lens.short.toLowerCase()} brands in {origin.city.countryName} now. New ones appear here in a couple of minutes, even if you leave.
              </p>
            )}
            {all !== null && list.length === 0 && !researching.includes(tab) && <p className={s.small}>No {lens.short.toLowerCase()} brands within your budget in {origin.city.countryName} in Feta&apos;s library yet.</p>}
            {list.map((b, i) => {
              // Brands above their budget aren't shown (brandsFor), except one they love.
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
                      {/* Feta's line on why it suits them; the research's line only when there isn't one. */}
                      {!b.forYou && b.why && <span className={`${s.small} ${s.clamp}`} style={{ color: "rgba(var(--inkRGB),0.75)" }}>{b.why}</span>}
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {fit === true && <span className={s.fits}>✓ In your budget</span>}
                        {fit === false && <span className={s.small}>Above your budget</span>}
                        {b.website && (
                          <a className={s.link} href={b.website} target="_blank" rel="noopener noreferrer">
                            Visit site ↗
                          </a>
                        )}
                        <button type="button" className={s.link} onClick={() => openTags(b.id)} aria-expanded={tagsFor?.id === b.id}>
                          {tagsFor?.id === b.id ? "Done" : "Edit styles"}
                        </button>
                      </div>
                      {tagsFor?.id === b.id && (
                        <div className={s.tagEdit}>
                          <span className={s.small}>Tap to add or remove. Your change shows for you now, and for everyone once others agree.</span>
                          <span className={s.chips}>
                            {STYLES.map((st) => {
                              const on = tagsFor.tags.includes(st.id);
                              return (
                                <button key={st.id} type="button" className={`${s.chip} ${on ? s.chipOn : ""}`} style={{ padding: "5px 10px", fontSize: 12 }} aria-pressed={on} onClick={() => toggleTag(b.id, st.id, on)}>
                                  {st.short}
                                </button>
                              );
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                    <button type="button" className={`${s.heart} ${saved.has(b.id) ? s.hearted : ""}`} aria-label={`Save ${b.name}`} aria-pressed={saved.has(b.id)} onClick={() => heart(b)}>
                      ♥
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Ask Feta to dig for more (founder: "there is no button for me to ask for more"). */}
          {all !== null && (
            <button
              type="button"
              className={s.findMore}
              disabled={researching.includes(tab)}
              onClick={async () => {
                setMoreNote(null);
                const note = await findMoreBrands(tab, origin.city.id, origin.city.country, () => reload.current(), setResearching);
                setMoreNote(note);
              }}
            >
              {researching.includes(tab) ? `Looking for more ${lens.short.toLowerCase()} brands…` : `＋ Find more ${lens.short.toLowerCase()} brands in ${origin.city.countryName}`}
            </button>
          )}
          {moreNote && <p className={s.small}>{moreNote}</p>}
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
