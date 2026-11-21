"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Mascot from "@/components/Mascot";
import { Figure, Line, Logo, StyleTop, vars } from "@/components/StyleParts";
import TabBar from "@/components/TabBar";
import WaitFun from "@/components/WaitFun";
import { loadOrigin } from "@/lib/origin";
import { OCCASIONS, STYLES, styleById, type Occasion, type Outfit } from "@/lib/style";
import { acrossStyles, brandsFor, drawLook, fromPhone, loadLovedBrands, rankForMe, researchCountry, loadStyleProfile, outfitFor, saveStyleProfile, tonightPlan, type BrandCard, type StyleProfile, type TonightPlan } from "@/lib/style-client";
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
  const [vibe, setVibe] = useState<string | null>(null); // what kind of dinner, drinks… (founder: "it never asked me what kind of dinner")
  const [own, setOwn] = useState("");
  const [look, setLook] = useState<string | null>(null); // the idea drawn
  const [drawingLook, setDrawingLook] = useState(false);
  const [changing, setChanging] = useState<"top" | "bottom" | "shoes" | null>(null); // one piece being swapped
  const [tried, setTried] = useState<Record<string, string[]>>({});
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Today's limit is reached: only that is said, not a plan or outing choices it can't dress.
  const [limited, setLimited] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [shown, setShown] = useState<string[]>([]);
  const [shownStyles, setShownStyles] = useState<string[]>([]); // so Another moves through their styles
  const [leaving, setLeaving] = useState(false);
  const [brands, setBrands] = useState<BrandCard[] | null>(null);
  const [lovedCount, setLovedCount] = useState(-1);
  const [drawn, setDrawn] = useState<Record<string, string>>({});
  // Read once: a new object each render made "think" change every render, and
  // the plan effect then asked for a look in a loop (20 Nov 2026: "Picking a
  // look" forever and the screen froze).
  const [origin] = useState(() => (typeof window === "undefined" ? null : loadOrigin()));

  useEffect(() => {
    loadStyleProfile().then((p) => {
      if (!p || !p.styles.length) {
        router.replace("/style/setup");
        return;
      }
      setProfile(p);
      if (p.onYou) Promise.all(p.styles.map(async (id) => [id, await fromPhone(`draw:${id}`)] as const)).then((all) => setDrawn(Object.fromEntries(all.filter(([, v]) => v)) as Record<string, string>));
      if (origin) {
        // Brands for their styles, ordered for them by Feta.
        const load = async () => {
          const [all, loved] = await Promise.all([brandsFor(p.styles, origin.city.country, p.wears, p.budget), loadLovedBrands()]);
          setLovedCount(loved.length);
          const mine = p.homegrownOnly ? all.filter((x) => x.homegrown) : all;
          // Shown straight away, then reordered for them when Feta's ranking arrives.
          setBrands(mine);
          setBrands(await rankForMe(mine, p, origin.city.countryName, loved.map((l) => l.name)));
          return all;
        };
        load().then((all) => researchCountry(origin.city.id, origin.city.country, p.styles.map((style) => ({ style, brands: all.filter((b) => b.style === style).length })), () => load()));
      }
    });
    tonightPlan().then(setPlan);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [router]);

  const think = useCallback(
    async (p: StyleProfile, o: Occasion | null, tonight: TonightPlan | null, avoid: string[], usedStyles: string[] = [], kind: string | null = null) => {
      if (!origin) return;
      setThinking(true);
      setNotice(null);
      const r = await outfitFor({
        styles: p.styles,
        wears: p.wears,
        occasion: o,
        vibe: kind,
        plan: tonight,
        cityId: origin.city.id,
        avoid,
        usedStyles,
        cues: p.cues,
        loved: p.votes.filter((v) => v.verdict === "love").map((v) => v.look).slice(-6),
        notMe: p.votes.filter((v) => v.verdict === "not_me").map((v) => v.look).slice(-6),
      });
      setThinking(false);
      setLeaving(false);
      if (r?.outfit) {
        setOutfit(r.outfit);
        // Draw this exact outfit (the style's own picture shows a different one).
        setLook(null);
        setDrawingLook(true);
        const drawnLook = await drawLook(r.outfit, p.wears);
        setDrawingLook(false);
        setLook(drawnLook);
        setShown((x) => [...x, r.outfit!.title]);
        setShownStyles((x) => [...x, r.outfit!.style]);
      } else {
        setNotice(r?.notice ?? "Feta couldn't think of a look just now.");
        setLimited(!!r?.limited);
      }
    },
    [origin],
  );

  // A plan for today decides the look straight away.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first idea once the plan is known
    if (profile && plan) think(profile, null, plan, []);
    // No plan: a look for the day straight away (founder, 21 Nov 2026: a
    // tester's first visit showed nothing to wear), never a plan assumed;
    // "Going somewhere else? Change" asks where they're going.
    else if (profile && plan === null) {
      setOccasion("day");
      think(profile, "day", null, []);
    }
  }, [profile, plan, think]);

  if (!profile || !origin) return null;

  function pick(o: Occasion) {
    setOccasion(o);
    setVibe(null);
  }

  function pickKind(kind: string) {
    setVibe(kind);
    setTried({});
    setShown([]);
    setShownStyles([]);
    setOutfit(null);
    think(profile!, occasion, null, [], [], kind);
  }

  function another() {
    if (!outfit) return;
    setLeaving(true);
    setTried({});
    setTimeout(() => think(profile!, occasion, plan ?? null, shown, shownStyles, vibe), 300);
  }

  // Change one piece and keep the rest (founder, 20 Nov 2026: "some might
  // like the pant idea but not the top").
  async function changePiece(piece: "top" | "bottom" | "shoes") {
    if (!outfit || !origin) return;
    setChanging(piece);
    const before = [...(tried[piece] ?? []), outfit.pieces[piece]];
    setTried({ ...tried, [piece]: before });
    const r = await outfitFor({
      styles: profile!.styles,
      wears: profile!.wears,
      occasion,
      vibe,
      plan: plan ?? null,
      cityId: origin.city.id,
      avoid: before,
      usedStyles: [],
      cues: profile!.cues,
      loved: [],
      notMe: [],
      change: { piece, outfit },
    });
    setChanging(null);
    if (!r?.outfit) return;
    setOutfit(r.outfit);
    setLook(null);
    setDrawingLook(true);
    const img = await drawLook(r.outfit, profile!.wears);
    setDrawingLook(false);
    setLook(img);
  }

  async function vote(verdict: "love" | "not_me") {
    if (!outfit) return;
    const p = { ...profile!, votes: [...profile!.votes, { look: outfit.title, verdict, at: new Date().toISOString() }] };
    setProfile(p);
    saveStyleProfile(p, origin!.city);
    if (verdict === "not_me") another();
  }

  const loved = outfit && profile.votes.some((v) => v.look === outfit.title && v.verdict === "love");
  const occ = OCCASIONS.find((o) => o.id === occasion);
  const heading = plan ? `For your plan: ${plan.title}` : occasion === "day" && !vibe ? "A look for today" : occ ? `${occ.label}${vibe ? ` · ${vibe.toLowerCase()}` : ""}` : "Heading out tonight?";
  const lineBrands = acrossStyles(brands ?? [], profile.styles, 5);

  return (
    <>
      <main className={s.screen}>
        <div className={s.page}>
          <StyleTop />
          <h1 className={s.mast}>
            {new Date().getHours() < 16 ? "Today" : "Tonight"}, <i>dressed for it.</i>
          </h1>

          <section className={s.stage} style={{ height: outfit || thinking ? 430 : 360 }}>
            <div style={{ position: "absolute", left: 16, top: 14, right: 16, zIndex: 5, display: "flex", flexDirection: "column", gap: 2 }}>
              <span className={s.kick} style={{ color: "#7a4f27" }}>
                WHAT TO WEAR {new Date().getHours() < 16 ? "TODAY" : "TONIGHT"}
              </span>
              {!limited && <span style={{ fontSize: 13, opacity: 0.75 }}>{plan === undefined ? "Checking your plans…" : heading}</span>}
            </div>

            {outfit && !thinking ? (
              <>
                <div key={`big-${outfit.title}`} className={`${s.big} ${s.rise}`} style={{ top: 70, fontSize: outfit.big1.length > 6 ? 72 : 92, zIndex: 1 }}>
                  <span>{outfit.big1}</span>
                  <i>{outfit.big2}</i>
                </div>
                {look ? (
                  <Figure key={`fig-${outfit.title}`} style={outfit.style} wears={profile.wears} drawn={look} height={330} spots={outfit.pieces} leaving={leaving} pos={{ zIndex: 2 }} label={`${outfit.title}: ${outfit.pieces.top}, ${outfit.pieces.bottom}, ${outfit.pieces.shoes}`} />
                ) : (
                  <div className={s.lookWait}>
                    {drawingLook && <span className={s.drawingWait} aria-hidden="true" />}
                    <span className={s.lookPieces}>
                      <span>{outfit.pieces.top}</span>
                      <span>{outfit.pieces.bottom}</span>
                      <span>{outfit.pieces.shoes}</span>
                    </span>
                    {drawingLook && <WaitFun kind="draw" compact onLight />}
                  </div>
                )}
              </>
            ) : thinking ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <Mascot pose="think" size={80} prop="shades" />
                <WaitFun kind="look" compact onLight />
              </div>
            ) : (
              <div style={{ position: "absolute", left: 16, right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 12, zIndex: 3 }}>
                <span className={s.small} style={{ color: "#1a1616", opacity: 0.75 }}>
                  {notice ?? (occ ? `What kind of ${occ.label.toLowerCase()}?` : "No plan saved for today. Where are you going?")}
                </span>
                {limited ? null : occ ? (
                  <>
                    <div className={s.chips}>
                      {occ.kinds.map((k) => (
                        <button key={k} type="button" className={s.chip} style={{ borderColor: "#1a1616", background: "#fff", color: "#1a1616" }} onClick={() => pickKind(k)}>
                          {k}
                        </button>
                      ))}
                    </div>
                    <form className={s.ownKind} onSubmit={(e) => { e.preventDefault(); if (own.trim()) pickKind(own.trim()); }}>
                      <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Or say it, e.g. rooftop with work friends" aria-label="What kind of outing" maxLength={60} />
                      <button type="submit" disabled={!own.trim()}>Go</button>
                    </form>
                    <button type="button" className={s.small} style={{ alignSelf: "flex-start", color: "#1a1616" }} onClick={() => setOccasion(null)}>
                      ‹ Somewhere else
                    </button>
                  </>
                ) : (
                  <div className={s.chips}>
                    {OCCASIONS.map((o) => (
                      <button key={o.id} type="button" className={s.chip} style={{ borderColor: "#1a1616", background: "#fff", color: "#1a1616" }} onClick={() => pick(o.id)}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Their styles stand behind the question, so the stage isn't empty. */}
            {!outfit && !thinking && !occ && (
              <div aria-hidden="true" style={{ position: "absolute", right: 0, top: 56, height: 150, width: "62%", opacity: 0.9 }}>
                {profile.styles.slice(0, 3).map((id, i) => (
                  <Figure key={id} style={id} wears={profile.wears} drawn={drawn[id]} height={150 - i * 22} pos={{ left: `${30 + i * 26}%`, zIndex: 3 - i, opacity: 1 - i * 0.2, animationDelay: `${i * 0.1}s` }} />
                ))}
              </div>
            )}
          </section>

          {outfit && !thinking && (
            <>
              <p className={s.sub} style={{ color: "var(--ink)" }}>{outfit.line}</p>
              <div className={s.pieces}>
                {(["top", "bottom", "shoes"] as const).map((k) => (
                  <div key={k} className={s.pieceRow}>
                    <span className={s.pieceKind}>{k === "top" ? "Top" : k === "bottom" ? "Bottom" : "Shoes"}</span>
                    <span className={s.pieceName}>{changing === k ? "Finding another…" : outfit.pieces[k]}</span>
                    <button type="button" className={s.link} disabled={!!changing || drawingLook} onClick={() => changePiece(k)}>
                      Change
                    </button>
                  </div>
                ))}
              </div>
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
                <button type="button" className={s.quiet} style={{ padding: 0, textAlign: "left" }} onClick={() => { setOutfit(null); setOccasion(null); setVibe(null); setLook(null); }}>
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

          {/* Optional, out of setup so it stays short (founder, 20 Nov 2026). */}
          {(!profile.onYou || lovedCount === 0) && (
            <div className={s.extras}>
              {!profile.onYou && (
                <button type="button" className={s.extra} onClick={() => router.push("/style/setup?step=2")}>
                  <b>See these looks on you</b>
                  <span>Add one photo and Feta draws your outfits as you.</span>
                </button>
              )}
              {lovedCount === 0 && (
                <button type="button" className={s.extra} onClick={() => router.push("/style/setup?step=4")}>
                  <b>Add brands you love</b>
                  <span>Feta finds more like them, and others like you see them.</span>
                </button>
              )}
            </div>
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
