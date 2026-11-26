"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Mascot from "@/components/Mascot";
import { Figure, Line, vars } from "@/components/StyleParts";
import { StyleFigure } from "@/components/StyleKit";
import { useToast } from "@/components/Toast";
import WaitFun from "@/components/WaitFun";
import { knownCurrency } from "@/lib/currency";
import { loadOrigin } from "@/lib/origin";
import { BUDGET_LEVELS, BUDGET_NAMES, STYLES, budgetLabels, stylePicture, styleById, type Wears } from "@/lib/style";
import { keepInspiration, loadInspiration, loadStyleProfile, readStylePhotos, saveStyleProfile, shrink, styleLimit, type StyleProfile } from "@/lib/style-client";
import k from "./StyleLook.module.css";
import s from "./StyleScreens.module.css";

// Style setup (founder, 20–23 Nov 2026, docs/style-spec.md), once:
// 0. The intro: three polaroids drop onto the clothesline (your plans · your
//    brands · every day) and what Style does in three lines.
// 1. What they shop for, asked first (every figure follows it), then the
//    clothesline: up to 8 inspiration photos, or tap Feta's looks (no AI).
// 3. Their styles: read from the photos (only the clothes) or the looks
//    they tapped, shown as a lineup; remove any.
// 5. Clothes budget per piece, in their city's currency.
// "Looks on you" and the brands they shop from live in My style, never as
// hidden setup steps. From My style (?from=me) it opens on a step and goes
// back there; Back never walks through the steps.
type Step = 0 | 1 | 3 | 5;
const FLOW: Step[] = [1, 3, 5];
const NEXT: Record<Step, Step> = { 0: 1, 1: 3, 3: 5, 5: 5 };
const PREV: Record<Step, Step> = { 0: 0, 1: 0, 3: 1, 5: 3 };
const MAX_PHOTOS = 8;

// How far down the rope sags at a point across the screen (0–1).
const sag = (f: number) => 10 + 48 * f * (1 - f);

export default function StyleSetup() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>(0);
  const [wears, setWears] = useState<Wears | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [tapped, setTapped] = useState<string[]>([]); // Feta's looks they tapped
  const [fromMe, setFromMe] = useState(false);
  const [styles, setStyles] = useState<string[]>([]);
  const [why, setWhy] = useState<Record<string, string>>({});
  const [seenIn, setSeenIn] = useState<Record<string, number[]>>({}); // which of their photos showed each style
  const [photoReads, setPhotoReads] = useState<{ saw: string; styles: string[] }[]>([]);
  const [notMe, setNotMe] = useState<string[]>([]); // styles Feta suggested that they said aren't them
  const [browse, setBrowse] = useState(false);
  const [front, setFront] = useState<string | null>(null); // the style standing in front of the lineup
  const [cues, setCues] = useState<string[]>([]);
  const [editing, setEditing] = useState(false); // they have a style already: any step can be opened
  const lastKept = useRef<{ photos: string[]; reads: typeof photoReads } | null>(null); // what's kept now
  const phoneOnly = useRef(false); // the account's photos couldn't be read, so they aren't overwritten
  const [photosRead, setPhotosRead] = useState(false); // their kept photos are back, so saving them can't wipe them
  const swipe = useRef<number | null>(null);
  const [reading, setReading] = useState(false);
  const [readCount, setReadCount] = useState(0); // photos already read into the styles
  // Why the photos couldn't be read, shown in place of the lineup (founder,
  // 20 Nov 2026: a toast vanished and left an empty box, "has it given up?").
  const [readFailed, setReadFailed] = useState<string | null>(null);
  // Nothing ticked to begin with (testers, 23 Nov 2026: Mid came ticked, so
  // tapping Mid and Treat saved only Treat).
  const [budget, setBudget] = useState<string[]>([]);
  const [homegrown, setHomegrown] = useState(false);
  const [votes, setVotes] = useState<StyleProfile["votes"]>([]);
  const [saving, setSaving] = useState(false);
  const [onYou, setOnYou] = useState(false);
  const [kept, setKept] = useState<Pick<StyleProfile, "wardrobe" | "offNotes">>({ wardrobe: [], offNotes: [] });
  // Over today's limit, said before any questions (founder, 21 Nov 2026).
  const [resting, setResting] = useState<string | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const [origin] = useState(() => (typeof window === "undefined" ? null : loadOrigin()));
  const currency = knownCurrency(origin?.city.currency);

  // Changing it later starts from what they have, at the step they asked
  // for (read once from the address, so the screen never waits on it).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const asked = Number(q.get("step"));
    /* eslint-disable react-hooks/set-state-in-effect -- the address is only readable in the browser */
    if (asked === 1 || asked === 3 || asked === 5) setStep(asked as Step);
    setFromMe(q.get("from") === "me");
    /* eslint-enable react-hooks/set-state-in-effect */
    loadInspiration()
      .then(({ kept: k, synced }) => {
        phoneOnly.current = !synced;
        // Photos already read stay read (the count is kept with the photos),
        // so nothing is sent to the AI twice.
        if (k) {
          setPhotos(k.photos);
          setPhotoReads(k.reads);
          lastKept.current = { photos: k.photos, reads: k.reads };
        }
        setReadCount(k ? Math.min(k.reads.length, k.photos.length) : 0);
      })
      .catch(() => null)
      .finally(() => setPhotosRead(true));
    loadStyleProfile().then((p) => {
      if (!p?.styles.length) styleLimit().then((r) => r?.notice && setResting(r.notice));
      if (!p) return;
      setEditing(p.styles.length > 0);
      if (p.styles.length) setWears(p.wears);
      setOnYou(p.onYou);
      setKept({ wardrobe: p.wardrobe, offNotes: p.offNotes });
      setStyles(p.styles);
      setBudget(p.budget);
      setHomegrown(p.homegrownOnly);
      setVotes(p.votes);
      setCues(p.cues);
    });
  }, []);

  // Their photos are kept for next time, only when they change (and never
  // emptied when the kept ones couldn't be read).
  useEffect(() => {
    if (!photosRead) return;
    const was = lastKept.current;
    if (was ? photos === was.photos && photoReads === was.reads : !photos.length) return;
    lastKept.current = { photos, reads: photoReads };
    keepInspiration({ photos, reads: photoReads }, { phoneOnly: phoneOnly.current });
  }, [photosRead, photos, photoReads]);

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    const room = MAX_PHOTOS - photos.length - tapped.length;
    const made = await Promise.all([...list].slice(0, room).map((f) => shrink(f).catch(() => null)));
    const ok = made.filter((p): p is string => !!p);
    if (list.length > room) toast(`Up to ${MAX_PHOTOS} photos. Kept the first ${room}.`);
    setPhotos((p) => [...p, ...ok].slice(0, MAX_PHOTOS));
  }

  // Step 3: read the photos once, when they arrive at their styles.
  useEffect(() => {
    if (step !== 3 || reading || photos.length === 0 || readCount === photos.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows the reading animation before the request
    setReading(true);
    setReadFailed(null);
    readStylePhotos(photos, wears ?? "women").then((r) => {
      setReading(false);
      setReadCount(photos.length);
      if (!r?.styles?.length) {
        setReadFailed(r?.notice ?? (r ? "Feta couldn't spot a clear outfit in those photos." : "Feta couldn't read those photos just now."));
        return;
      }
      // What the photos show first, then the looks they tapped.
      const read = r.styles;
      const ids = [...read.map((x) => x.id), ...tapped.filter((id) => !read.some((x) => x.id === id))];
      setStyles(ids);
      setNotMe([]);
      setWhy(Object.fromEntries(r.styles.map((x) => [x.id, x.why])));
      setSeenIn(Object.fromEntries(r.styles.map((x) => [x.id, x.photos])));
      setPhotoReads(r.photos ?? []);
      setCues((r.photos ?? []).map((x) => x.saw).filter((x) => x && x !== "No clear outfit"));
      setFront(ids[0]);
    });
  }, [step, photos, wears, reading, readCount, tapped, toast]);

  async function finish() {
    setSaving(true);
    const ok = await saveStyleProfile({ wears: wears ?? "women", styles, readFromPhotos: readCount, budget, homegrownOnly: homegrown, onYou, votes, cues, ...kept }, origin?.city ?? null);
    // Not saved: say so and let them try again, never stuck on "Saving…" or
    // sent back to the start (testers, 26 Nov 2026).
    if (!ok) {
      setSaving(false);
      toast("Couldn't save that just now. Check your connection and tap again.");
      return;
    }
    // An in-app move once the save is done, so Home keeps its picks
    // (founder, 23 Nov 2026: "every time I go back home it's refreshing").
    router.replace(fromMe ? "/style/me" : "/style");
  }

  // Next from the clothesline: photos are read on the styles step; looks
  // they tapped need no AI and go straight there.
  function lineNext() {
    // Photos already read need no new read, so looks tapped since go straight in.
    if (tapped.length && (!photos.length || readCount === photos.length)) {
      setStyles((cur) => [...tapped, ...cur.filter((id) => !tapped.includes(id))].slice(0, 6));
      setFront(tapped[0]);
      setReadFailed(null);
    }
    setStep(NEXT[1]);
  }

  const sentence = (() => {
    const n = (id: string) => (styleById(id)?.short ?? id).toLowerCase().replace("y2k", "Y2K");
    if (!styles.length) return "Pick the styles that feel like you";
    if (styles.length === 1) return `Mostly ${n(styles[0])}.`;
    if (styles.length === 2) return `Mostly ${n(styles[0])}, with a bit of ${n(styles[1])}.`;
    return `Mostly ${n(styles[0])} and ${n(styles[1])}, with a bit of ${styles.slice(2).map(n).join(" and ")}.`;
  })();
  const labels = budgetLabels(currency);

  if (resting)
    return (
      <main className={s.screen}>
        <div className={`${s.page} ${s.resting}`}>
          <Mascot pose="sorry" prop="shades" size={110} pop />
          <h1 className={s.title}>
            Style is <strong>resting.</strong>
          </h1>
          <p className={s.sub}>{resting}</p>
          <button type="button" className={s.primary} onClick={() => window.history.back()}>
            OK
          </button>
        </div>
      </main>
    );

  return (
    <main className={s.screen}>
      <div className={s.page}>
        {/* The same header and progress bar as the other setup questions; once they have a style, any step can be opened. */}
        <div className={s.setupTop}>
          <button
            type="button"
            onClick={() =>
              // From My style, Back goes back there; never through the steps.
              fromMe || editing
                ? router.push(fromMe ? "/style/me" : "/style")
                : step > 0
                  ? setStep(PREV[step])
                  : router.push("/home")
            }
          >
            ‹ {fromMe ? "My style" : step === 0 ? "Home" : "Back"}
          </button>
          {editing ? (
            <button type="button" className={s.done} disabled={saving || !styles.length || reading} onClick={finish}>
              {saving ? "Saving…" : "Done"}
            </button>
          ) : step === 0 ? (
            <span className={k.cap}>
              Style<span className={k.beta}>BETA</span>
            </span>
          ) : (
            <span>
              Your style · {Math.max(1, FLOW.filter((n) => n <= step).length)} of 3
            </span>
          )}
        </div>
        {step > 0 && <div className={s.progress} aria-label="Steps">
          {FLOW.map((n) => (
            <button key={n} type="button" className={n <= step ? s.doneBar : ""} aria-label={`Step ${FLOW.indexOf(n) + 1}: ${n === 1 ? "shop for and looks you love" : n === 3 ? "your styles" : "budget"}`} aria-current={step === n ? "step" : undefined} disabled={!editing && n > step} onClick={() => setStep(n)}>
              <span />
            </button>
          ))}
        </div>}

        {step === 0 && (
          <>
            {/* The intro (founder, 23 Nov 2026, option 2): three polaroids drop onto the clothesline and swing. */}
            <div className={k.introLine}>
              <svg viewBox="0 0 390 60" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 14 Q195 44 390 14" stroke="var(--rope)" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className={k.introPols}>
                {[
                  ["polished-minimal", "your plans"],
                  ["streetwear", "your brands"],
                  ["indian-fusion", "every day"],
                ].map(([id, cap], i) => (
                  <div key={id} className={k.introSlot}>
                    <span className={k.peg} />
                    <div className={k.ipol} style={{ animationDelay: `${i * 0.2}s, ${0.9 + i * 0.2}s` }}>
                      <div className={k.ipolIn}>
                        <StyleFigure style={id} wears={wears ?? "women"} />
                      </div>
                      <i>{cap}</i>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <h1 className={s.mast}>
              Stylish, <i>wherever you&apos;re going.</i>
            </h1>
            <div>
              <div className={k.ben} style={{ animationDelay: "0.3s" }}>
                <span className={k.ico} style={{ background: "var(--rose)" }}>✦</span>
                <span>
                  <b>Looks made for your plans</b>
                  <p>Dinner, work, a gig: Feta dresses you for where you&apos;re going, in your styles.</p>
                </span>
              </div>
              <div className={k.ben} style={{ animationDelay: "0.45s" }}>
                <span className={k.ico} style={{ background: "var(--saffron)" }}>♥</span>
                <span>
                  <b>Brands for your styles</b>
                  <p>Discover labels that fit your styles and budget, where you live.</p>
                </span>
              </div>
              <div className={k.ben} style={{ animationDelay: "0.6s" }}>
                <span className={k.ico} style={{ background: "var(--turquoise)" }}>✓</span>
                <span>
                  <b>Put together, every day</b>
                  <p>Feta remembers what you own and what you wore.</p>
                </span>
              </div>
            </div>
            <div className={s.bottomBar}>
              <button type="button" className={s.primary} onClick={() => setStep(1)}>
                Let&apos;s start ›
              </button>
              <span className={s.quiet}>Takes about a minute</span>
            </div>
          </>
        )}

        {step > 0 && <Mascot pose={step === 3 ? "think" : step === 5 ? "idle" : "wave"} prop="shades" size={64} pop />}

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
            {!wears && <p className={s.small}>Pick one first. Every look Feta shows follows it.</p>}
            {wears && (<>
            <div>
              <h2 className={s.h2} style={{ marginTop: 10 }}>
                Hang up looks <i>you love</i>
              </h2>
              <p className={s.sub} style={{ marginTop: 6 }}>
                Up to 8 photos: Pinterest or Instagram screenshots, or your own. Even one works. Feta&apos;s AI is asked to read only the clothes. Your photos are kept on your account, seen only by you; sign in with Google and they come back on any phone. Deleting your data deletes them.
              </p>
            </div>
            <Line height={300} rows={[0, 150]}>
              {Array.from({ length: MAX_PHOTOS }, (_, i) => {
                const row = Math.floor(i / 4);
                const f = 0.13 + (i % 4) * 0.247;
                // Their photos, then Feta's looks they tapped, on the same line
                // (founder's tester, 23 Nov 2026: tapped looks showed "0 / 8").
                const photo = photos[i];
                const look = photo ? undefined : tapped[i - photos.length];
                const hung = !!(photo || look);
                return (
                  <div key={photo ? `p${i}-${photo.length}` : look ? `t${look}` : `e${i}`} className={`${s.hang} ${hung ? "" : s.still}`} style={vars({ left: `calc(${f * 100}% - 38px)`, top: row * 150 + sag(f) - 4, "--sway": `${3.2 + (i % 3) * 0.5}s`, "--delay": `${i * 0.2}s` })}>
                    <div className={`${s.hanger} ${hung ? s.dropIn : ""}`}>
                      <span className={s.peg} style={hung ? undefined : { opacity: 0.4 }} />
                      {photo ? (
                        <span className={s.polaroid}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- their photo, only on this phone */}
                          <img src={photo} alt={`Inspiration photo ${i + 1}`} />
                          <button type="button" className={s.unpin} aria-label={`Remove photo ${i + 1}`} onClick={() => { setPhotos((p) => p.filter((_, j) => j !== i)); setPhotoReads((r) => r.filter((_, j) => j !== i)); if (i < readCount) setReadCount((n) => n - 1); }}>
                            ✕
                          </button>
                        </span>
                      ) : look ? (
                        <span className={s.polaroid} style={{ overflow: "hidden" }}>
                          <span style={{ position: "absolute", inset: "5px 5px 14px", overflow: "hidden", background: "var(--stage)" }}>
                            <StyleFigure style={look} wears={wears ?? "women"} imgStyle={{ position: "absolute", top: 0, height: "100%", maxWidth: "none" }} />
                          </span>
                          <button type="button" className={s.unpin} aria-label={`Take down ${styleById(look)?.short ?? "look"}`} onClick={() => setTapped((cur) => cur.filter((x) => x !== look))}>
                            ✕
                          </button>
                        </span>
                      ) : (
                        <button type="button" className={s.polaroidEmpty} aria-label="Add photos" disabled={!photosRead} onClick={() => files.current?.click()}>
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
                {Math.min(MAX_PHOTOS, photos.length + tapped.length)}
                <span> / 8</span>
              </span>
            </div>
            <input ref={files} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files).then(() => (e.target.value = ""))} />
            {editing && <p className={s.small}>Your styles are ticked below. Add photos or tap more looks.</p>}
            <span style={{ fontSize: 15, fontWeight: 600 }}>{editing ? `All ${STYLES.length} of Feta's looks` : "No photos? Tap Feta's looks"}</span>
            {/* Every style, theirs first (founder, 25 Nov 2026: "why can i only see 9 styles?"). */}
            <div className={k.tiles}>
              {[...styles, ...STYLES.map((l) => l.id).filter((id) => !styles.includes(id))].map((id) => {
                const mine = styles.includes(id);
                const on = mine || tapped.includes(id);
                const toggle = () => {
                  if (mine) {
                    if (styles.length > 1) setStyles((cur) => cur.filter((x) => x !== id));
                    else toast("Keep at least one style");
                    return;
                  }
                  if (!tapped.includes(id) && photos.length + tapped.length >= MAX_PHOTOS) return toast(`Up to ${MAX_PHOTOS} photos and looks in all`);
                  setTapped((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
                };
                return (
                  <button key={id} type="button" className={`${k.tile} ${on ? k.tileOn : ""}`} aria-pressed={on} onClick={toggle}>
                    <StyleFigure style={id} wears={wears} />
                    <span className={k.tileName}>{styleById(id)?.short}</span>
                    {on && <span className={k.tick} aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </div>
            </>)}
            <div className={s.bottomBar}>
              <button type="button" className={s.primary} disabled={!wears || (!photos.length && !tapped.length && !editing)} onClick={lineNext}>
                {!wears ? "Pick what you shop for" : photos.length || tapped.length ? `Next · ${photos.length + tapped.length} look${photos.length + tapped.length === 1 ? "" : "s"} ›` : editing ? "Next ›" : "Hang up at least one look"}
              </button>
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
                <div style={{ position: "absolute", left: 0, right: 0, bottom: -64 }}>
                  <WaitFun kind="read" compact />
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
                          {behind.slice(0, 3).map((id, j) => {
                            const h = Math.round(270 * Math.pow(0.8, j));
                            const lens = styleById(id)!;
                            const w = Math.round(h / 2);
                            return (
                              <button key={id} type="button" className={s.behind} aria-label={`Bring ${lens.name} to the front`} onClick={() => setFront(id)} style={vars({ left: `calc(50% + ${j * 54}px)`, bottom: 30, width: w, height: h, zIndex: 9 - j, opacity: 1 - j * 0.15, "--fx": fan[j % 4][0], "--fy": fan[j % 4][1], "--fr": fan[j % 4][2], "--delay": `${0.1 + j * 0.08}s` })}>
                                <span className={s.bob} style={{ display: "block" }}>
                                  {/* eslint-disable-next-line @next/next/no-img-element -- a fixed picture from Feta's library */}
                                  <img src={stylePicture(id, wears ?? "women", id)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "10% top" }} />
                                </span>
                              </button>
                            );
                          })}
                          <Figure key={`front-${frontId}`} style={frontId} wears={wears ?? "women"} height={340} pos={{ left: 10, marginLeft: 0, bottom: 30, zIndex: 10 }} />
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
                        <div style={{ padding: 20, color: "#1a1616", display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
                          {readFailed && <p className={s.sub} style={{ margin: 0, color: "#1a1616" }}>{readFailed}</p>}
                          <p className={s.sub} style={{ margin: 0, color: "#1a1616" }}>
                            {readFailed ? "Try again, or tap the styles below that feel like you." : "Tap the styles below that feel like you."}
                          </p>
                          {readFailed && photos.length > 0 && (
                            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button type="button" className={s.chip} onClick={() => setReadCount(0)}>
                                Try again
                              </button>
                              {/* Setup never gets stuck (founder, 22 Nov 2026): Feta's looks need no AI. */}
                              <button type="button" className={`${s.chip} ${s.chipOn}`} onClick={() => { setPhotos([]); setReadFailed(null); setStep(1); }}>
                                Pick from Feta&apos;s looks
                              </button>
                            </span>
                          )}
                        </div>
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
                        return (
                          <button key={l.id} type="button" className={s.thumb} style={browse ? { width: "auto" } : undefined} onClick={() => { setStyles([...styles, l.id]); setNotMe(notMe.filter((x) => x !== l.id)); setFront(l.id); }}>
                            <span className={s.thumbImg}>
                              {/* eslint-disable-next-line @next/next/no-img-element -- a fixed picture from Feta's library */}
                              <img src={stylePicture(l.id, wears ?? "women", l.id)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "10% top" }} />
                            </span>
                            {l.short}
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" className={s.link} style={{ alignSelf: "flex-start", fontSize: 13 }} onClick={() => setBrowse(!browse)} aria-expanded={browse}>
                      {browse ? "Show as a row" : "See all 37 at once"}
                    </button>
                    <p className={s.small}>The figures show each style, not you.</p>
                  </>
                );
              })()
            )}
            <div className={s.bottomBar}>
              <button type="button" className={s.primary} disabled={reading || !styles.length} onClick={() => setStep(NEXT[3])}>
                {reading ? "Reading…" : styles.length ? `Continue with ${styles.length} style${styles.length === 1 ? "" : "s"} ›` : "Pick at least one style to continue"}
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
                {saving ? "Saving…" : budget.length ? "See my style" : "Tick at least one"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
