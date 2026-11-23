"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StyleFigure, StyleHead } from "@/components/StyleKit";
import { Line, Logo, vars } from "@/components/StyleParts";
import TabBar from "@/components/TabBar";
import { useToast } from "@/components/Toast";
import { loadOrigin } from "@/lib/origin";
import { STYLES, styleById } from "@/lib/style";
import { formatMoney } from "@/lib/currency";
import { brandTags, brandsFor, findMoreBrands, loadLovedBrands, loadStyleProfile, loveBrand, rankForMe, recommendSetting, researchCountry, saveStyleProfile, savedBrandIds, setRecommendBrands, setTagVote, toggleSavedBrand, type BrandCard, type LovedBrand, type StyleProfile } from "@/lib/style-client";
import k from "./StyleLook.module.css";
import s from "./StyleScreens.module.css";

// Brand discovery (founder, 20–23 Nov 2026, docs/style-spec.md). "For you"
// mixes all their styles: ★ Feta Picks, then brands people with their taste
// shop from, then brands that fit more of their styles; a chip per style
// shows only its brands. Their country's stores only, within their budget,
// with honest price labels (brandsFor). ♥ means "I shop here": it joins
// "Your usuals" at the top, and the first ♥ asks once whether to recommend
// them to people with a similar taste. Saving one to try later is separate.
// From a piece of a look (?piece=…&style=…): brands for that look's style,
// with ‹ Back to your look.
const FOR_YOU = "for-you";
export default function StyleBrands() {
  const router = useRouter();
  const toastMsg = useToast();
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [all, setAll] = useState<BrandCard[] | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [researching, setResearching] = useState<string[]>([]); // styles Feta is researching now
  const [moreNote, setMoreNote] = useState<string | null>(null);
  const reload = useRef<() => Promise<unknown>>(async () => null);
  const [tagsFor, setTagsFor] = useState<{ id: string; tags: string[]; mine: Record<string, 1 | -1> } | null>(null);
  const [usuals, setUsuals] = useState<LovedBrand[]>([]);
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [ask, setAsk] = useState<BrandCard | null>(null); // "Recommend them?" asked once
  const [piece, setPiece] = useState<string | null>(null);
  const [origin] = useState(() => (typeof window === "undefined" ? null : loadOrigin()));

  useEffect(() => {
    loadStyleProfile().then((p) => {
      if (!p || !origin) return;
      setProfile(p);
      const q = new URLSearchParams(window.location.search);
      const asked = q.get("style");
      setPiece(q.get("piece"));
      setTab(asked && p.styles.includes(asked) ? asked : FOR_YOU);
      // Ordered for them by Feta, with a line on why.
      const load = async () => {
        const [all, loved] = await Promise.all([brandsFor(p.styles, origin.city, p.wears, p.budget), loadLovedBrands()]);
        setUsuals(loved);
        // Shown once Feta has ordered them, and never reordered under their
        // finger after that (testers, 23 Nov 2026: a ♥ on Uniqlo landed on
        // another brand when the list re-sorted): brands found later by
        // research join at the end.
        const ranked = await rankForMe(all, p, origin.city.countryName, loved.map((l) => l.name));
        const at = (b: BrandCard) => `${b.id}:${b.style}`;
        setAll((shown) => {
          if (!shown) return ranked;
          const now = new Map(ranked.map((b) => [at(b), b]));
          const kept = shown.filter((b) => now.has(at(b))).map((b) => now.get(at(b))!);
          return [...kept, ...ranked.filter((b) => !shown.some((x) => at(x) === at(b)))];
        });
        return all;
      };
      reload.current = load;
      load().then((all) => researchCountry(origin.city.id, origin.city.country, p.styles.map((style) => ({ style, brands: all.filter((b) => b.style === style).length })), () => load(), setResearching));
    });
    savedBrandIds().then(setSaved);
    recommendSetting().then(setRecommend);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  if (!profile || !origin || !tab) return null;
  const home = profile.homegrownOnly;
  const lens = tab === FOR_YOU ? null : styleById(tab);
  // How many of their styles each brand fits; For you shows each brand once.
  const fitCount = new Map<string, number>();
  for (const b of all ?? []) fitCount.set(b.id, (fitCount.get(b.id) ?? 0) + 1);
  const forYou = (() => {
    const seen = new Set<string>();
    const one = (all ?? []).filter((b) => !seen.has(b.id) && seen.add(b.id));
    // Stable: keeps Feta Picks and loved-by first (brandsFor), then fits more
    // styles. Not by their own ♥, which would move a card as it's tapped
    // (persona re-test, 23 Nov 2026); their usuals have their own row.
    return one
      .map((b, i) => ({ b, i }))
      .sort((x, y) => Number(!!y.b.fetaPick) - Number(!!x.b.fetaPick) || (y.b.lovers ?? 0) - (x.b.lovers ?? 0) || (fitCount.get(y.b.id) ?? 1) - (fitCount.get(x.b.id) ?? 1) || x.i - y.i)
      .map((x) => x.b);
  })();
  const list = tab === FOR_YOU ? forYou : (all ?? []).filter((b) => b.style === tab);
  const shown = list.filter((b) => !home || b.homegrown);
  const country = origin.city.countryName;

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

  // Save to try later (Saved → Brands), separate from "I shop here".
  function save(b: BrandCard) {
    const on = !saved.has(b.id);
    const next = new Set(saved);
    if (on) next.add(b.id);
    else next.delete(b.id);
    setSaved(next);
    if (on) toastMsg("Saved to Saved → Brands");
    toggleSavedBrand(b, on, origin!.city.country);
  }

  // ♥ I shop here: one of their usuals.
  async function shopHere(b: BrandCard, rec: boolean | null = recommend) {
    if (b.youLove) {
      setAll((x) => x && x.map((c) => (c.id === b.id ? { ...c, youLove: false } : c)));
      setUsuals((u) => u.filter((x) => x.id !== b.id));
      await loveBrand(b.id, false);
      return;
    }
    if (rec === null) {
      setAsk(b);
      return;
    }
    setAll((x) => x && x.map((c) => (c.id === b.id ? { ...c, youLove: true } : c)));
    setUsuals((u) => [...u, { id: b.id, name: b.name, logo: b.logo, styles: [b.style] }]);
    await loveBrand(b.id, true, { recommend: rec, country: origin!.city.country });
    toastMsg(`${b.name} added to your usuals`);
  }

  async function answer(rec: boolean) {
    const b = ask;
    setAsk(null);
    setRecommend(rec);
    if (b) await shopHere(b, rec);
    await setRecommendBrands(rec);
  }

  return (
    <>
      <main className={`${s.screen} ${s.vars}`}>
        <div className={s.page}>
          <StyleHead tab="brands" back={piece ? () => router.back() : undefined} backLabel={piece ? "Back to your look" : "Home"} />
          {piece ? (
            <div className={k.pieceHead}>
              <span className={k.thumbImg}>
                <StyleFigure style={tab === FOR_YOU ? profile.styles[0] : tab} wears={profile.wears} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className={k.cap} style={{ color: "#7a4f27" }}>Where to buy</span>
                <span className={k.lookTitle} style={{ fontSize: 22 }}>{piece}</span>
                <span style={{ fontSize: 13, opacity: 0.75 }}>
                  {lens ? `${lens.short} brands` : "Brands for your styles"} in {country}, within your budget. Your look is kept.
                </span>
              </span>
            </div>
          ) : (
            <h1 className={s.mast} style={{ marginBottom: 0 }}>
              Brands for <i>your styles</i>
            </h1>
          )}

          <div className={k.usuals}>
            <span className={k.label} style={{ flex: "none" }}>Your usuals</span>
            {usuals.length ? usuals.map((u) => <span key={u.id} className={k.uchip}>{u.name}</span>) : <span style={{ fontSize: 12, opacity: 0.7 }}>Tap ♥ on a brand you shop from</span>}
            <button type="button" className={k.mini} style={{ marginLeft: "auto", flex: "none" }} onClick={() => router.push("/style/me#brands")}>
              + Add
            </button>
          </div>

          <div className={s.chips}>
            {[FOR_YOU, ...profile.styles].map((id) => (
              <button key={id} type="button" className={`${s.chip} ${tab === id ? s.chipOn : ""}`} style={{ padding: "8px 14px", fontSize: 13 }} aria-pressed={tab === id} onClick={() => setTab(id)}>
                {id === FOR_YOU ? "For you" : styleById(id)?.short}
              </button>
            ))}
          </div>
          <span className={s.small}>
            {all === null ? "Finding brands…" : tab === FOR_YOU ? `All your styles mixed: brands that fit more of them come first. ${shown.length} in ${country}.` : `Only ${lens?.short.toLowerCase()} brands, in ${country}, within your budget. ${shown.length} found.`}
          </span>

          {/* The first few, hanging on a line. */}
          {shown.length > 0 && (
            <Line height={128}>
              {shown.slice(0, 5).map((b, i) => {
                const f = 0.1 + i * 0.2;
                return (
                  <div key={b.id} className={s.hang} style={vars({ left: `calc(${f * 100}% - 35px)`, top: 10 + 48 * f * (1 - f) - 2, "--sway": `${3 + (i % 3) * 0.5}s`, "--delay": `${i * 0.2}s` })}>
                    <span className={`${s.hanger} ${s.dropIn}`}>
                      <span className={s.string} />
                      <span className={s.brandTag}>
                        <Logo name={b.name} src={b.logo} />
                        <span className={s.brandTagName}>{b.name}</span>
                      </span>
                    </span>
                  </div>
                );
              })}
            </Line>
          )}

          <button type="button" className={`${s.switch} ${home ? s.switchOn : ""}`} aria-pressed={home} onClick={toggleHome}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Homegrown only</span>
              <span style={{ fontSize: 12, opacity: 0.75 }}>{home ? `Only labels started in ${country}` : `Off: ${country} labels and international ones that sell here`}</span>
            </span>
            <span className={s.track}>
              <span className={s.knob} />
            </span>
          </button>

          <div key={`list-${tab}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lens && researching.includes(tab) && (
              <p className={s.researching}>
                <span aria-hidden="true" /> Feta is looking for more {lens.short.toLowerCase()} brands in {country} now. New ones appear here in a couple of minutes, even if you leave.
              </p>
            )}
            {all !== null && list.length === 0 && !researching.includes(tab) && <p className={s.small}>No brands within your budget in {country} in Feta&apos;s library yet{lens ? ` for ${lens.short.toLowerCase()}` : ""}.</p>}
            {list.map((b, i) => {
              const fits = fitCount.get(b.id) ?? 1;
              // Brands above their budget aren't shown (brandsFor), except one they love.
              const fit = b.price.fit;
              const checked = b.price.checked ? new Date(b.price.checked).toLocaleDateString("en", { month: "short", year: "numeric" }) : null;
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
                          {b.youLove ? "♥ One of your usuals" : `♥ Loved by ${b.lovers} ${b.lovers === 1 ? "person" : "people"} with your taste`}
                        </span>
                      )}
                      {tab === FOR_YOU && fits > 1 && <span className={s.small} style={{ color: "var(--tan)" }}>Fits {fits} of your styles</span>}
                      {b.forYou && <span className={s.forYou}>{b.forYou}</span>}
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
                        {fit === "fits" && b.price.price !== null && (
                          <span className={s.fits}>
                            ✓ In your budget · from {formatMoney(b.price.price, origin.city.currency)}
                            {checked ? `, checked ${checked}` : ""}
                          </span>
                        )}
                        {b.backup ? (
                          <span className={s.small}>Sold in many countries · not yet checked in {country}</span>
                        ) : (
                          fit === "explore" && <span className={s.small}>{b.price.price !== null ? `From ${formatMoney(b.price.price, origin.city.currency)}` : "Brand to explore · prices not checked"}</span>
                        )}
                        {fit === "above" && b.youLove && <span className={s.small}>Above your budget</span>}
                        <a className={s.link} style={{ whiteSpace: "nowrap" }} href={b.link.href} target="_blank" rel="noopener noreferrer">
                          {b.link.label}
                        </a>
                        <button type="button" className={s.link} style={{ whiteSpace: "nowrap" }} onClick={() => save(b)} aria-pressed={saved.has(b.id)}>
                          {saved.has(b.id) ? "Saved" : "Save"}
                        </button>
                        <button type="button" className={s.link} style={{ whiteSpace: "nowrap" }} onClick={() => openTags(b.id)} aria-expanded={tagsFor?.id === b.id}>
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
                    <button type="button" className={`${k.shopHeart} ${b.youLove ? k.shopHeartOn : ""}`} aria-label={`I shop at ${b.name}`} aria-pressed={!!b.youLove} onClick={() => shopHere(b)}>
                      ♥
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Ask Feta to dig for more (founder: "there is no button for me to ask for more"). */}
          {all !== null && lens && (
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
              {researching.includes(tab) ? `Looking for more ${lens.short.toLowerCase()} brands…` : `＋ Find more ${lens.short.toLowerCase()} brands in ${country}`}
            </button>
          )}
          {moreNote && <p className={s.small}>{moreNote}</p>}
        </div>
      </main>
      {ask && (
        <>
          <button type="button" className={k.shade} aria-label="Close" onClick={() => setAsk(null)} />
          <div className={k.sheet} role="dialog" aria-label="Recommend your brands?">
            <div className={k.grab} />
            <span className={k.lookTitle} style={{ fontSize: 22 }}>{ask.name} is one of your usuals</span>
            <span style={{ fontSize: 14, opacity: 0.75 }}>Recommend the brands you shop from to people with a similar taste? They&apos;d see &ldquo;♥ Loved by people with your taste&rdquo;, never your name.</span>
            <button type="button" className={k.primary} onClick={() => answer(true)}>
              Yes, recommend them
            </button>
            <button type="button" className={k.ghost} onClick={() => answer(false)}>
              Keep them to me
            </button>
          </div>
        </>
      )}
      <TabBar active="style" />
    </>
  );
}
