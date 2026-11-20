"use client";

import { useEffect, useRef, useState } from "react";
import Mascot from "@/components/Mascot";
import { Figure, Line, Logo, vars } from "@/components/StyleParts";
import { useToast } from "@/components/Toast";
import { knownCurrency } from "@/lib/currency";
import { loadOrigin } from "@/lib/origin";
import { BUDGET_LEVELS, BUDGET_NAMES, STYLES, budgetLabels, figureHalf, lookImage, styleById, type Wears } from "@/lib/style";
import { drawStyle, forgetOnYou, fromPhone, keepOnPhone, loadLovedBrands, loadStyleProfile, lookupNewBrand, loveBrand, readStylePhotos, saveStyleProfile, searchBrands, setRecommendBrands, shrink, type LovedBrand, type StyleProfile } from "@/lib/style-client";
import s from "./StyleScreens.module.css";

// Style setup (founder, 20 Nov 2026), once, changeable later:
// 1. What they shop for, and up to 8 inspiration photos (none required).
// 2. See it on you (optional): one photo of them, so their styles are drawn as them.
// 3. Their styles: read from the photos (or picked), shown as a lineup.
// 4. Brands they love (optional), like the places they love.
// 5. Clothes budget, in their city's currency.
type Step = 1 | 2 | 3 | 4 | 5;
const MAX_PHOTOS = 8;

// How far down the rope sags at a point across the screen (0–1).
const sag = (f: number) => 10 + 48 * f * (1 - f);

export default function StyleSetup() {
  const toast = useToast();
  const [step, setStep] = useState<Step>(1);
  const [wears, setWears] = useState<Wears>("women");
  const [photos, setPhotos] = useState<string[]>([]);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [styles, setStyles] = useState<string[]>([]);
  const [why, setWhy] = useState<Record<string, string>>({});
  const [seenIn, setSeenIn] = useState<Record<string, number[]>>({}); // which of their photos showed each style
  const [photoReads, setPhotoReads] = useState<{ saw: string; styles: string[] }[]>([]);
  const [notMe, setNotMe] = useState<string[]>([]); // styles Feta suggested that they said aren't them
  const [browse, setBrowse] = useState(false);
  const [front, setFront] = useState<string | null>(null); // the style standing in front of the lineup
  const [cues, setCues] = useState<string[]>([]);
  const [editing, setEditing] = useState(false); // they have a style already: any step can be opened
  const swipe = useRef<number | null>(null);
  const [reading, setReading] = useState(false);
  const [readCount, setReadCount] = useState(0); // photos already read into the styles
  const [drawn, setDrawn] = useState<Record<string, string>>({});
  const [drawing, setDrawing] = useState<Record<string, boolean>>({});
  const [budget, setBudget] = useState<string[]>(["c2"]);
  const [homegrown, setHomegrown] = useState(false);
  const [votes, setVotes] = useState<StyleProfile["votes"]>([]);
  const [saving, setSaving] = useState(false);
  const [loved, setLoved] = useState<LovedBrand[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; logo: string | null }[]>([]);
  const [looking, setLooking] = useState(false);
  const [recommend, setRecommend] = useState(true);
  const files = useRef<HTMLInputElement>(null);
  const selfieFile = useRef<HTMLInputElement>(null);
  const origin = typeof window === "undefined" ? null : loadOrigin();
  const currency = knownCurrency(origin?.city.currency);

  // Changing it later starts from what they have, at the step they asked
  // for (read once from the address, so the screen never waits on it).
  useEffect(() => {
    const asked = Number(new URLSearchParams(window.location.search).get("step"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is only readable in the browser
    if (asked >= 1 && asked <= 5) setStep(asked as Step);
    loadStyleProfile().then((p) => {
      if (!p) return;
      setEditing(p.styles.length > 0);
      setWears(p.wears);
      setStyles(p.styles);
      setBudget(p.budget.length ? p.budget : ["c2"]);
      setHomegrown(p.homegrownOnly);
      setVotes(p.votes);
      setReadCount(p.readFromPhotos);
      setCues(p.cues);
    });
    fromPhone("selfie").then((p) => p && setSelfie(p));
    loadLovedBrands().then(setLoved);
    Promise.all(STYLES.map(async (l) => [l.id, await fromPhone(`draw:${l.id}`)] as const)).then((all) => setDrawn(Object.fromEntries(all.filter(([, v]) => v)) as Record<string, string>));
  }, []);

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    const room = MAX_PHOTOS - photos.length;
    const made = await Promise.all([...list].slice(0, room).map((f) => shrink(f).catch(() => null)));
    const ok = made.filter((p): p is string => !!p);
    if (list.length > room) toast(`Up to ${MAX_PHOTOS} photos. Kept the first ${room}.`);
    setPhotos((p) => [...p, ...ok].slice(0, MAX_PHOTOS));
  }

  async function addSelfie(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    const p = await shrink(f, 1024).catch(() => null);
    if (!p) return toast("Couldn't open that photo.");
    setSelfie(p);
    setDrawn({});
    await forgetOnYou();
    await keepOnPhone("selfie", p);
  }

  // Step 3: read the photos once, when they arrive at their styles.
  useEffect(() => {
    if (step !== 3 || reading || photos.length === 0 || readCount === photos.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows the reading animation before the request
    setReading(true);
    readStylePhotos(photos, wears).then((r) => {
      setReading(false);
      setReadCount(photos.length);
      if (!r?.styles?.length) {
        toast(r?.notice ?? "Feta couldn't read those photos. Pick your styles below.");
        return;
      }
      const ids = r.styles.map((x) => x.id);
      setStyles(ids);
      setNotMe([]);
      setWhy(Object.fromEntries(r.styles.map((x) => [x.id, x.why])));
      setSeenIn(Object.fromEntries(r.styles.map((x) => [x.id, x.photos])));
      setPhotoReads(r.photos ?? []);
      setCues((r.photos ?? []).map((x) => x.saw).filter((x) => x && x !== "No clear outfit"));
      setFront(ids[0]);
    });
  }, [step, photos, wears, reading, readCount, toast]);

  // Their styles drawn as them, one at a time as they appear (about ₹4 each).
  useEffect(() => {
    if (step !== 3 || !selfie || reading) return;
    for (const id of styles) {
      if (drawn[id] || drawing[id]) continue;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the drawing as started
      setDrawing((d) => ({ ...d, [id]: true }));
      drawStyle(selfie, id).then(async (r) => {
        setDrawing((d) => ({ ...d, [id]: false }));
        if (r?.image) {
          setDrawn((d) => ({ ...d, [id]: r.image! }));
          await keepOnPhone(`draw:${id}`, r.image);
        }
      });
    }
  }, [step, selfie, styles, drawn, drawing, reading]);

  // Brands they love: the library as they type.
  useEffect(() => {
    if (step !== 4) return;
    const t = setTimeout(() => searchBrands(query).then(setFound), 200);
    return () => clearTimeout(t);
  }, [query, step]);

  async function addLoved(b: { id: string; name: string; logo: string | null }) {
    setQuery("");
    setFound([]);
    if (loved.some((x) => x.id === b.id)) return;
    await loveBrand(b.id, true, { recommend, country: origin?.city.country });
    setLoved(await loadLovedBrands());
  }

  async function addNew() {
    const name = query.trim();
    if (!origin || name.length < 2) return;
    setLooking(true);
    const r = await lookupNewBrand(name, origin.city.id);
    setLooking(false);
    if (r?.brand) await addLoved({ ...r.brand, logo: null });
    else toast(r?.notice ?? "Couldn't find that brand.");
  }

  async function finish() {
    setSaving(true);
    await saveStyleProfile({ wears, styles, readFromPhotos: readCount, budget, homegrownOnly: homegrown, onYou: !!selfie, votes, cues }, origin?.city ?? null);
    // A full load back to Style home: the in-app move back from Edit could
    // be overtaken by the earlier move into Edit and land on setup again
    // (founder, 20 Nov 2026: "its stuck in saving the budget").
    window.location.replace("/style");
  }

  const sentence = (() => {
    const n = (id: string) => (styleById(id)?.short ?? id).toLowerCase().replace("y2k", "Y2K");
    if (!styles.length) return "Pick the styles that feel like you";
    if (styles.length === 1) return `Mostly ${n(styles[0])}.`;
    if (styles.length === 2) return `Mostly ${n(styles[0])}, with a bit of ${n(styles[1])}.`;
    return `Mostly ${n(styles[0])} and ${n(styles[1])}, with a bit of ${styles.slice(2).map(n).join(" and ")}.`;
  })();
  const labels = budgetLabels(currency);

  return (
    <main className={s.screen}>
      <div className={s.page}>
        {/* The same header and progress bar as the other setup questions; once they have a style, any step can be opened. */}
        <div className={s.setupTop}>
          <button
            type="button"
            onClick={() =>
              step > 1
                ? setStep((step - 1) as Step)
                : editing
                  ? // A full load back to Style while editing (see finish()).
                    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                    window.location.assign("/style")
                  : window.history.back()
            }
          >
            ‹ Back
          </button>
          {editing ? (
            <button type="button" className={s.done} disabled={saving || !styles.length || reading} onClick={finish}>
              {saving ? "Saving…" : "Done"}
            </button>
          ) : (
            <span>
              Your style · {step} of 5
            </span>
          )}
        </div>
        <div className={s.progress} aria-label="Steps">
          {([1, 2, 3, 4, 5] as Step[]).map((n) => (
            <button key={n} type="button" className={n <= step ? s.doneBar : ""} aria-label={`Step ${n}: ${["", "shop for and photos", "on you", "your styles", "brands you love", "budget"][n]}`} aria-current={step === n ? "step" : undefined} disabled={!editing && n > step} onClick={() => setStep(n)}>
              <span />
            </button>
          ))}
        </div>
        <Mascot pose={step === 3 ? "think" : step === 5 ? "idle" : "wave"} prop="shades" size={64} pop />

        {step === 1 && (
          <>
            <h1 className={s.title}>
              What do you <strong>shop for?</strong>
            </h1>
            <div className={s.chips}>
              {(["women", "men", "both"] as Wears[]).map((w) => (
                <button key={w} type="button" className={`${s.chip} ${wears === w ? s.chipOn : ""}`} aria-pressed={wears === w} onClick={() => setWears(w)}>
                  {w === "women" ? "Womenswear" : w === "men" ? "Menswear" : "Both"}
                </button>
              ))}
            </div>
            <div>
              <h2 className={s.h2} style={{ marginTop: 10 }}>
                Hang up looks <i>you love</i>
              </h2>
              <p className={s.sub} style={{ marginTop: 6 }}>
                Up to 8 photos: Pinterest or Instagram screenshots, or your own. Even one works. Feta keeps only the style words, never the photos.
              </p>
            </div>
            <Line height={300} rows={[0, 150]}>
              {Array.from({ length: MAX_PHOTOS }, (_, i) => {
                const row = Math.floor(i / 4);
                const f = 0.13 + (i % 4) * 0.247;
                const photo = photos[i];
                return (
                  <div key={photo ? `p${i}-${photo.length}` : `e${i}`} className={`${s.hang} ${photo ? "" : s.still}`} style={vars({ left: `calc(${f * 100}% - 38px)`, top: row * 150 + sag(f) - 4, "--sway": `${3.2 + (i % 3) * 0.5}s`, "--delay": `${i * 0.2}s` })}>
                    <div className={`${s.hanger} ${photo ? s.dropIn : ""}`}>
                      <span className={s.peg} style={photo ? undefined : { opacity: 0.4 }} />
                      {photo ? (
                        <span className={s.polaroid}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- their photo, only on this phone */}
                          <img src={photo} alt={`Inspiration photo ${i + 1}`} />
                          <button type="button" className={s.unpin} aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}>
                            ✕
                          </button>
                        </span>
                      ) : (
                        <button type="button" className={s.polaroidEmpty} aria-label="Add photos" onClick={() => files.current?.click()}>
                          +
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </Line>
            <div className={s.row}>
              <span className={s.small}>Tap a peg to add photos</span>
              <span className={s.count}>
                {photos.length}
                <span> / 8</span>
              </span>
            </div>
            <input ref={files} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files).then(() => (e.target.value = ""))} />
            {editing && !photos.length && <p className={s.small}>Your styles are saved. Add new photos to read them again, or go straight to any step above.</p>}
            <div className={s.bottomBar}>
              <button type="button" className={s.primary} onClick={() => setStep(2)}>
                {photos.length ? `Next · ${photos.length} photo${photos.length === 1 ? "" : "s"}` : "Next"}
              </button>
              {!photos.length && <span className={s.quiet}>No photos handy? You&apos;ll pick styles yourself.</span>}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <span className={s.kick}>OPTIONAL</span>
            <h1 className={s.title}>
              See the looks <strong>on you</strong>
            </h1>
            <p className={s.sub}>Add one photo of yourself and Feta draws your styles as you. Skip it and you&apos;ll see Feta&apos;s own illustrations.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className={s.selfie} style={{ flex: 1 }} onClick={() => selfieFile.current?.click()}>
                {selfie ? (
                  // eslint-disable-next-line @next/next/no-img-element -- their photo, only on this phone
                  <img src={selfie} alt="Your photo" />
                ) : (
                  <>
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 7h3l2-2h6l2 2h3v12H4z" />
                      <circle cx="12" cy="13" r="3.5" />
                    </svg>
                    <span style={{ fontWeight: 600 }}>Add one photo</span>
                    <span className={s.small}>Head to toe works best</span>
                  </>
                )}
              </button>
              <div className={s.stage} style={{ width: 120, height: 300, flex: "none" }}>
                <Figure style={styles[0] ?? "smart-casual"} wears={wears} height={290} />
                <span className={s.drawingWait} aria-hidden="true" />
              </div>
            </div>
            <input ref={selfieFile} type="file" accept="image/*" hidden onChange={(e) => addSelfie(e.target.files).then(() => (e.target.value = ""))} />
            <div className={s.note}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Your photo, plainly</span>
              <span className={s.small}>
                It goes to Google&apos;s image AI only to draw you, about ₹4 a style. Feta doesn&apos;t keep it; the photo and drawings stay on this phone. Feta never comments on your body, size or looks.
              </span>
            </div>
            <div className={s.bottomBar}>
              <button type="button" className={s.primary} onClick={() => setStep(3)}>
                {selfie ? "Draw my styles on me" : "Skip, use Feta's figures"}
              </button>
              {selfie && (
                <button type="button" className={s.quiet} onClick={async () => { setSelfie(null); setDrawn({}); await forgetOnYou(); }}>
                  Remove my photo
                </button>
              )}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className={s.kick}>{reading ? `READING YOUR ${photos.length} PHOTO${photos.length === 1 ? "" : "S"}` : photos.length ? `FETA READ YOUR ${photos.length} PHOTO${photos.length === 1 ? "" : "S"}` : "YOUR STYLES"}</span>
              <h1 className={s.title} style={{ fontSize: 27 }}>
                {reading ? "Looking at the clothes…" : styles.length ? sentence : "Which styles feel like you?"}
              </h1>
            </div>

            {reading ? (
              <div className={s.stage} style={{ height: 300 }}>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {photos.slice(0, 5).map((p, i) => (
                    <span key={i} className={s.polaroid} style={{ position: "absolute", transform: `rotate(${(i - 2) * 7}deg) translateX(${(i - 2) * 26}px)` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- their photo, only on this phone */}
                      <img src={p} alt="" />
                    </span>
                  ))}
                  <span className={s.drawingWait} aria-hidden="true" />
                </div>
              </div>
            ) : (
              (() => {
                const frontId = front && styles.includes(front) ? front : styles[0];
                // The ones after the front come next, wrapping round; three at most stand behind.
                const at = frontId ? styles.indexOf(frontId) : 0;
                const behind = [...styles.slice(at + 1), ...styles.slice(0, at)];
                const fan = [["-160px", "-60px", "-14deg"], ["140px", "-120px", "12deg"], ["-60px", "160px", "-8deg"], ["180px", "90px", "10deg"]];
                const from = frontId ? (seenIn[frontId] ?? []) : [];
                return (
                  <>
                    {/* The lineup: their styles, one in front; tap one behind to bring it forward. */}
                    <div
                      className={`${s.stage} ${s.lineup}`}
                      style={{ margin: 0, height: 400, touchAction: "pan-y" }}
                      onTouchStart={(e) => (swipe.current = e.touches[0].clientX)}
                      onTouchEnd={(e) => {
                        // Swipe through their styles (founder: "I am not able to see the 4th one I am adding").
                        const dx = swipe.current === null ? 0 : e.changedTouches[0].clientX - swipe.current;
                        swipe.current = null;
                        if (Math.abs(dx) < 40 || !frontId) return;
                        const i = styles.indexOf(frontId);
                        setFront(styles[(i + (dx < 0 ? 1 : styles.length - 1)) % styles.length]);
                      }}
                    >
                      {frontId ? (
                        <>
                          <span key={`big-${frontId}`} className={`${s.big} ${s.rise}`} style={{ top: 18, left: -8, right: "auto", alignItems: "flex-start", fontSize: (styleById(frontId)?.big.length ?? 0) > 5 ? 72 : 100, color: "rgba(26,22,22,0.12)" }}>
                            {styleById(frontId)?.big}
                          </span>
                          {behind.slice(0, 3).map((id, j) => {
                            const h = Math.round(270 * Math.pow(0.8, j));
                            const lens = styleById(id)!;
                            const half = drawn[id] ? "drawn" : figureHalf(lens, wears);
                            const w = drawn[id] ? Math.round((h * 9) / 16) : half === "both" ? h : Math.round(h / 2);
                            return (
                              <button key={id} type="button" className={s.behind} aria-label={`Bring ${lens.name} to the front`} onClick={() => setFront(id)} style={vars({ left: `calc(50% + ${j * 54}px)`, bottom: 30, width: w, height: h, zIndex: 9 - j, opacity: 1 - j * 0.15, "--fx": fan[j % 4][0], "--fy": fan[j % 4][1], "--fr": fan[j % 4][2], "--delay": `${0.1 + j * 0.08}s` })}>
                                <span className={drawn[id] ? s.drawing : s.bob} style={{ display: "block" }}>
                                  {/* eslint-disable-next-line @next/next/no-img-element -- cropped to one figure */}
                                  <img src={drawn[id] ?? lookImage(id)} alt="" style={drawn[id] ? undefined : { height: h, width: h, left: half === "right" ? -w : 0 }} />
                                </span>
                                {drawing[id] && <span className={s.drawingWait} aria-hidden="true" />}
                              </button>
                            );
                          })}
                          <Figure key={`front-${frontId}-${drawn[frontId] ? 1 : 0}`} style={frontId} wears={wears} drawn={drawn[frontId]} height={drawn[frontId] ? 350 : 340} pos={{ left: 10, marginLeft: 0, bottom: 30, zIndex: 10 }} />
                          {drawing[frontId] && <span className={s.drawingNote}>Drawing you…</span>}
                          {styles.length > 1 && (
                            <span className={s.lineupDots}>
                              {styles.map((id) => (
                                <button key={id} type="button" className={id === frontId ? s.dotOn : ""} aria-label={styleById(id)?.name} onClick={() => setFront(id)} />
                              ))}
                            </span>
                          )}
                          <span className={s.lookCount}>
                            LOOK {String(styles.indexOf(frontId) + 1).padStart(2, "0")} / {String(styles.length).padStart(2, "0")}
                          </span>
                        </>
                      ) : (
                        <p className={s.sub} style={{ padding: 20, color: "#1a1616" }}>
                          Tap the styles below that feel like you.
                        </p>
                      )}
                    </div>

                    {/* Why this style: what Feta saw, and the photos it came from. */}
                    {frontId && (
                      <div key={`card-${frontId}`} className={s.styleCard} style={{ flexDirection: "column", gap: 8 }}>
                        <span className={s.styleName} style={{ fontSize: 22 }}>{styleById(frontId)?.name}</span>
                        {why[frontId] && <span className={s.small} style={{ color: "rgba(var(--inkRGB),0.8)" }}>{why[frontId]}</span>}
                        {from.length > 0 ? (
                          <span className={s.fromPhotos}>
                            {from.slice(0, 6).map((n) => (
                              // eslint-disable-next-line @next/next/no-img-element -- their photo, only on this phone
                              <img key={n} src={photos[n]} alt={`Your photo ${n + 1}: ${photoReads[n]?.saw ?? ""}`} />
                            ))}
                            <span>
                              Seen in {from.length} of your {photos.length} photo{photos.length === 1 ? "" : "s"}
                            </span>
                          </span>
                        ) : (
                          <span className={s.small}>Added by you</span>
                        )}
                        <span style={{ display: "flex", gap: 8 }}>
                          <button type="button" className={`${s.chip} ${s.chipOn}`} style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => setFront(behind[0] ?? frontId)}>
                            ✓ That&apos;s me{behind.length ? " · next" : ""}
                          </button>
                          <button type="button" className={s.chip} style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => { setStyles(styles.filter((x) => x !== frontId)); setNotMe([...notMe.filter((x) => x !== frontId), frontId]); setFront(behind[0] ?? null); }}>
                            Not me
                          </button>
                        </span>
                      </div>
                    )}
                    {notMe.length > 0 && (
                      <span className={s.small}>
                        Not you:{" "}
                        {notMe.map((id) => (
                          <button key={id} type="button" className={s.link} style={{ marginRight: 10 }} onClick={() => { setStyles([...styles, id]); setNotMe(notMe.filter((x) => x !== id)); setFront(id); }}>
                            {styleById(id)?.short} ↺
                          </button>
                        ))}
                      </span>
                    )}

                    {/* What Feta saw in each photo. */}
                    {photoReads.length > 0 && (
                      <>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>What Feta saw in each photo</span>
                        <div className={s.thumbs} style={{ gap: 12 }}>
                          {photos.map((p, i) => (
                            <div key={i} className={s.seen}>
                              <span className={s.polaroid} style={{ width: 70, height: 90 }}>
                                {/* eslint-disable-next-line @next/next/no-img-element -- their photo, only on this phone */}
                                <img src={p} alt={`Your photo ${i + 1}`} />
                              </span>
                              <span className={s.seenText}>{photoReads[i]?.saw || "…"}</span>
                              <span className={s.seenStyle}>{(photoReads[i]?.styles ?? []).map((id) => styleById(id)?.short).join(" · ")}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <span style={{ fontSize: 13, fontWeight: 600 }}>{styles.length ? "Also feels like you? Tap to add" : "Which feel like you? Tap to add"}</span>
                    <div className={browse ? s.allStyles : s.thumbs}>
                      {STYLES.filter((l) => !styles.includes(l.id)).map((l) => {
                        const half = figureHalf(l, wears);
                        return (
                          <button key={l.id} type="button" className={s.thumb} style={browse ? { width: "auto" } : undefined} onClick={() => { setStyles([...styles, l.id]); setNotMe(notMe.filter((x) => x !== l.id)); setFront(l.id); }}>
                            <span className={s.thumbImg}>
                              {/* eslint-disable-next-line @next/next/no-img-element -- cropped to one figure */}
                              <img src={lookImage(l.id)} alt="" style={{ left: half === "right" ? -64 : half === "both" ? -32 : 0 }} />
                            </span>
                            {l.short}
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" className={s.link} style={{ alignSelf: "flex-start", fontSize: 13 }} onClick={() => setBrowse(!browse)} aria-expanded={browse}>
                      {browse ? "Show as a row" : "See all 37 at once"}
                    </button>
                    <p className={s.small}>{selfie ? "The drawings are sketches of each style from your photo, not a replica of you." : "The figures show each style, not you."}</p>
                  </>
                );
              })()
            )}
            <div className={s.bottomBar}>
              <button type="button" className={s.primary} disabled={reading || !styles.length} onClick={() => setStep(4)}>
                {reading ? "Reading…" : styles.length ? `Continue with ${styles.length} style${styles.length === 1 ? "" : "s"} ›` : "Pick at least one style to continue"}
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <span className={s.kick}>OPTIONAL</span>
            <h1 className={s.title}>
              Brands you <strong>love</strong>
            </h1>
            <p className={s.sub}>A few you already shop from. Feta uses them to sharpen your styles and find more like them.</p>
            <div style={{ position: "relative" }}>
              <input className={s.search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a brand, e.g. Jaywalking" aria-label="Type a brand you love" maxLength={60} />
              {query.trim().length >= 2 && (
                <div className={s.results}>
                  {found.map((b) => (
                    <button key={b.id} type="button" className={s.result} onClick={() => addLoved(b)}>
                      <Logo name={b.name} src={b.logo} />
                      <span>{b.name}</span>
                    </button>
                  ))}
                  {!found.some((b) => b.name.toLowerCase() === query.trim().toLowerCase()) && (
                    <button type="button" className={s.result} onClick={addNew} disabled={looking}>
                      <span className={s.logo} aria-hidden="true">＋</span>
                      <span>{looking ? `Looking up “${query.trim()}”…` : `Add “${query.trim()}”`}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            {loved.length > 0 && (
              <Line height={128}>
                {loved.slice(0, 5).map((b, i) => {
                  const f = 0.1 + i * 0.2;
                  return (
                    <div key={b.id} className={s.hang} style={vars({ left: `calc(${f * 100}% - 35px)`, top: sag(f) - 2, "--sway": `${3 + (i % 3) * 0.5}s`, "--delay": `${i * 0.25}s` })}>
                      <div className={`${s.hanger} ${s.dropIn}`}>
                        <span className={s.string} />
                        <span className={s.brandTag}>
                          <Logo name={b.name} src={b.logo} />
                          <span className={s.brandTagName}>{b.name}</span>
                          <button type="button" className={s.unpin} aria-label={`Remove ${b.name}`} onClick={async () => { await loveBrand(b.id, false); setLoved(loved.filter((x) => x.id !== b.id)); }}>
                            ✕
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </Line>
            )}
            {loved.length > 5 && <span className={s.small}>And {loved.slice(5).map((b) => b.name).join(", ")}</span>}
            {(() => {
              const extra = [...new Set(loved.flatMap((b) => b.styles))].filter((id) => !styles.includes(id) && styleById(id));
              return extra.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Your brands also say. Add?</span>
                  <div className={s.chips}>
                    {extra.slice(0, 6).map((id) => (
                      <button key={id} type="button" className={s.chip} style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => setStyles([...styles, id])}>
                        {styleById(id)?.short} ＋
                      </button>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}
            {loved.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Recommend them to people like you?</span>
                <span className={s.small}>They&apos;d see &ldquo;♥ Loved by Feta users&rdquo;. Never your name.</span>
                <div className={s.chips}>
                  {[true, false].map((v) => (
                    <button key={String(v)} type="button" className={`${s.chip} ${recommend === v ? s.chipOn : ""}`} aria-pressed={recommend === v} onClick={() => { setRecommend(v); setRecommendBrands(v); }}>
                      {v ? "Yes" : "Keep them to me"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={s.bottomBar}>
              <button type="button" className={s.primary} onClick={() => setStep(5)}>
                {loved.length ? "Next" : "Skip for now"}
              </button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h1 className={s.title}>
              Clothes budget, <strong>per piece</strong>
            </h1>
            <p className={s.sub}>Separate from eating out. Tick all that feel right. Prices follow your city ({origin?.city.name ?? "where you are"}), the same way food does.</p>
            <Line height={170}>
              {BUDGET_LEVELS.map((id, i) => {
                const f = 0.13 + i * 0.247;
                const on = budget.includes(id);
                return (
                  <div key={id} className={`${s.hang} ${s.hangSoft}`} style={vars({ left: `calc(${f * 100}% - 39px)`, top: sag(f) - 2, "--sway": `${3 + i * 0.4}s`, "--delay": `${i * 0.15}s` })}>
                    <div className={s.hanger}>
                      <span className={s.string} />
                      <button type="button" className={`${s.tag} ${on ? s.tagOn : ""}`} style={vars({ "--delay": `${i * 0.06}s` })} aria-pressed={on} onClick={() => setBudget(on ? budget.filter((b) => b !== id) : [...budget, id])}>
                        <span className={s.tagName}>{BUDGET_NAMES[i]}</span>
                        <span className={s.tagPrice}>{labels[i]}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </Line>
            <div className={s.bottomBar}>
              <button type="button" className={s.primary} disabled={!budget.length || saving} onClick={finish}>
                {saving ? "Saving…" : "See my style"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
