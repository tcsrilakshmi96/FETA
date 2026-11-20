"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Mascot from "@/components/Mascot";
import { Figure, Line, Logo, StyleTop, vars } from "@/components/StyleParts";
import TabBar from "@/components/TabBar";
import { loadOrigin } from "@/lib/origin";
import { OCCASIONS, STYLES, styleById, type Occasion, type Outfit } from "@/lib/style";
import { brandsFor, fromPhone, researchCountry, loadStyleProfile, outfitFor, saveStyleProfile, tonightPlan, type BrandCard, type StyleProfile, type TonightPlan } from "@/lib/style-client";
import s from "./StyleScreens.module.css";

// Style home (founder, 20 Nov 2026), one job per part:
// 1. What to wear tonight: for their saved plan for today, or the outing
//    they tap when there's no plan. Dots on the clothes say what to wear;
//    Love it / Not my style teach Feta; Another gives a new idea.
// 2. Brands for their styles that sell in their country, hanging on a line.
// 3. Their styles, with Edit.
// No style yet: setup first.

const sag = (f: number) => 10 + 48 * f * (1 - f);

export default function Style() {
  const router = useRouter();
  const [profile, setProfile] = useState<StyleProfile | null | undefined>(undefined);
  const [plan, setPlan] = useState<TonightPlan | null | undefined>(undefined);
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [shown, setShown] = useState<string[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [brands, setBrands] = useState<BrandCard[] | null>(null);
  const [drawn, setDrawn] = useState<Record<string, string>>({});
  const origin = typeof window === "undefined" ? null : loadOrigin();

  useEffect(() => {
    loadStyleProfile().then((p) => {
      if (!p || !p.styles.length) {
        router.replace("/style/setup");
        return;
      }
      setProfile(p);
      if (p.onYou) Promise.all(p.styles.map(async (id) => [id, await fromPhone(`draw:${id}`)] as const)).then((all) => setDrawn(Object.fromEntries(all.filter(([, v]) => v)) as Record<string, string>));
      if (origin) {
        const load = () => brandsFor(p.styles, origin.city.country, p.wears).then((b) => setBrands(p.homegrownOnly ? b.filter((x) => x.homegrown) : b));
        load();
        researchCountry(origin.city.id, origin.city.country, p.styles, (style) => p.styles.includes(style) && load());
      }
    });
    tonightPlan().then(setPlan);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [router]);

  const think = useCallback(
    async (p: StyleProfile, o: Occasion | null, tonight: TonightPlan | null, avoid: string[]) => {
      if (!origin) return;
      setThinking(true);
      setNotice(null);
      const r = await outfitFor({
        styles: p.styles,
        wears: p.wears,
        occasion: o,
        plan: tonight,
        cityId: origin.city.id,
        avoid,
        loved: p.votes.filter((v) => v.verdict === "love").map((v) => v.look).slice(-6),
        notMe: p.votes.filter((v) => v.verdict === "not_me").map((v) => v.look).slice(-6),
      });
      setThinking(false);
      setLeaving(false);
      if (r?.outfit) {
        setOutfit(r.outfit);
        setShown((x) => [...x, r.outfit!.title]);
      } else setNotice(r?.notice ?? "Feta couldn't think of a look just now.");
    },
    [origin],
  );

  // A plan for today decides the look straight away.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first idea once the plan is known
    if (profile && plan) think(profile, null, plan, []);
  }, [profile, plan, think]);

  if (!profile || !origin) return null;

  function pick(o: Occasion) {
    setOccasion(o);
    setShown([]);
    setOutfit(null);
    think(profile!, o, null, []);
  }

  function another() {
    if (!outfit) return;
    setLeaving(true);
    setTimeout(() => think(profile!, occasion, plan ?? null, shown), 300);
  }

  async function vote(verdict: "love" | "not_me") {
    if (!outfit) return;
    const p = { ...profile!, votes: [...profile!.votes, { look: outfit.title, verdict, at: new Date().toISOString() }] };
    setProfile(p);
    saveStyleProfile(p, origin!.city);
    if (verdict === "not_me") another();
  }

  const loved = outfit && profile.votes.some((v) => v.look === outfit.title && v.verdict === "love");
  const heading = plan ? `For your plan: ${plan.title}` : occasion ? `For ${OCCASIONS.find((o) => o.id === occasion)?.label.toLowerCase()}` : "Heading out tonight?";
  const lineBrands = (brands ?? []).filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i).slice(0, 5);

  return (
    <>
      <main className={s.screen}>
        <div className={s.page}>
          <StyleTop />

          <section className={s.stage} style={{ height: outfit || thinking ? 430 : 300 }}>
            <div style={{ position: "absolute", left: 16, top: 14, right: 16, zIndex: 5, display: "flex", flexDirection: "column", gap: 2 }}>
              <span className={s.kick} style={{ color: "#7a4f27" }}>
                WHAT TO WEAR {new Date().getHours() < 16 ? "TODAY" : "TONIGHT"}
              </span>
              <span style={{ fontSize: 13, opacity: 0.75 }}>{plan === undefined ? "Checking your plans…" : heading}</span>
            </div>

            {outfit && !thinking ? (
              <>
                <div key={`big-${outfit.title}`} className={`${s.big} ${s.rise}`} style={{ top: 70, fontSize: outfit.big1.length > 6 ? 72 : 92, zIndex: 1 }}>
                  <span>{outfit.big1}</span>
                  <i>{outfit.big2}</i>
                </div>
                <Figure key={`fig-${outfit.title}`} style={outfit.style} wears={profile.wears} drawn={drawn[outfit.style]} height={330} spots={outfit.pieces} leaving={leaving} pos={{ zIndex: 2 }} />
              </>
            ) : thinking ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <Mascot pose="think" size={80} prop="shades" />
                <span style={{ fontSize: 13 }}>Picking a look…</span>
              </div>
            ) : (
              <div style={{ position: "absolute", left: 16, right: 16, bottom: 16, top: 70, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 12, zIndex: 3 }}>
                <span className={s.small} style={{ color: "#1a1616", opacity: 0.75 }}>
                  {notice ?? "No plan saved for today. Where are you going?"}
                </span>
                <div className={s.chips}>
                  {OCCASIONS.map((o) => (
                    <button key={o.id} type="button" className={s.chip} style={{ borderColor: "#1a1616", background: "#fff", color: "#1a1616" }} onClick={() => pick(o.id)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Their styles stand behind the question, so the stage isn't empty. */}
            {!outfit && !thinking && (
              <div aria-hidden="true" style={{ position: "absolute", right: 0, top: 30, height: 200, width: "60%", opacity: 0.9 }}>
                {profile.styles.slice(0, 3).map((id, i) => (
                  <Figure key={id} style={id} wears={profile.wears} drawn={drawn[id]} height={200 - i * 30} pos={{ left: `${30 + i * 26}%`, zIndex: 3 - i, opacity: 1 - i * 0.2, animationDelay: `${i * 0.1}s` }} />
                ))}
              </div>
            )}
          </section>

          {outfit && !thinking && (
            <>
              <p className={s.sub} style={{ color: "var(--ink)" }}>{outfit.line}</p>
              <div className={s.chips}>
                {outfit.chips.map((c) => (
                  <span key={c} className={s.fact}>
                    {c}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className={`${s.chip} ${loved ? s.chipOn : ""}`} style={{ flex: 1, fontSize: 13 }} onClick={() => vote("love")} aria-pressed={!!loved}>
                  {loved ? "♥ Loved" : "Love it"}
                </button>
                <button type="button" className={s.chip} style={{ flex: 1, fontSize: 13 }} onClick={() => vote("not_me")}>
                  Not my style
                </button>
                <button type="button" className={s.chip} style={{ flex: 1, fontSize: 13 }} onClick={another}>
                  Another ›
                </button>
              </div>
              {!plan && (
                <button type="button" className={s.quiet} style={{ padding: 0, textAlign: "left" }} onClick={() => { setOutfit(null); setOccasion(null); }}>
                  Going somewhere else? Change
                </button>
              )}
              <button type="button" className={s.card} style={{ background: "var(--ink)", color: "var(--bg)", justifyContent: "space-between" }} onClick={() => router.push(`/style/brands?style=${outfit.style}`)}>
                <span style={{ fontSize: 13 }}>Find this look: {styleById(outfit.style)?.short} brands</span>
                <span>›</span>
              </button>
            </>
          )}

          <div className={s.row} style={{ marginTop: 6 }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span className={s.kick}>BRANDS FOR YOUR STYLES</span>
              <span className={s.small}>That sell in {origin.city.countryName}{profile.homegrownOnly ? " · homegrown only" : ""}</span>
            </span>
            <button type="button" className={s.link} style={{ fontSize: 13 }} onClick={() => router.push("/style/brands")}>
              See all ›
            </button>
          </div>
          {brands === null ? (
            <span className={s.small}>Finding brands…</span>
          ) : lineBrands.length ? (
            <Line height={128}>
              {lineBrands.map((b, i) => {
                const f = 0.1 + i * 0.2;
                return (
                  <button key={b.id} type="button" className={s.hang} style={vars({ left: `calc(${f * 100}% - 35px)`, top: sag(f) - 2, "--sway": `${3 + (i % 3) * 0.5}s`, "--delay": `${i * 0.25}s` })} onClick={() => router.push(`/style/brands?style=${b.style}`)}>
                    <span className={s.hanger}>
                      <span className={s.string} />
                      <span className={s.brandTag}>
                        <Logo name={b.name} src={b.logo} />
                        <span className={s.brandTagName}>{b.name}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </Line>
          ) : (
            <span className={s.small}>No brands for your styles in {origin.city.countryName} yet. Feta is still building its library here.</span>
          )}

          <button type="button" className={s.card} onClick={() => router.push("/style/setup?step=3")}>
            <span className={s.kick} style={{ color: "rgba(var(--inkRGB),0.55)" }}>YOUR STYLES</span>
            <span style={{ fontSize: 13.5, flex: 1, textAlign: "left" }}>{profile.styles.map((id) => STYLES.find((x) => x.id === id)?.short).join(" · ")}</span>
            <span className={s.link}>Edit</span>
          </button>
        </div>
      </main>
      <TabBar active="style" />
    </>
  );
}
