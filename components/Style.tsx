"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Mascot from "@/components/Mascot";
import { LookCard, PieceSheet, StyleFigure, StyleHead, useLookPicture } from "@/components/StyleKit";
import TabBar from "@/components/TabBar";
import { FROM_KEY } from "@/components/WearCard";
import { useToast } from "@/components/Toast";
import WaitFun from "@/components/WaitFun";
import { loadOrigin } from "@/lib/origin";
import { WHERES, styleById, type LookFor, type Where } from "@/lib/style";
import { chooseLook, chosenLookFor, cityDay, cityNow, forgetOnMe, loadSet, loadStyleProfile, lookForPlan, newSet, saveStyleProfile, setLookFor, swapInSet, tonightPlan, wornOn, type LookSet, type StyleProfile } from "@/lib/style-client";
import k from "./StyleLook.module.css";
import s from "./StyleScreens.module.css";

// Style · Today (founder, 22–23 Nov 2026, docs/style-spec.md). What the look
// is for, checked in this order: a plan or place they chose; the look they
// already chose today; a saved plan for today; else "Where are you going?"
// (never guessed, never Home's suggested plan). Then 3 complete looks from
// their styles, best fit first: swipe left or ✕ for the next, swipe right or
// Wear this to wear it, ‹ for the last one. After all 3, "What's off?".
// The day's looks are kept on their account, so coming back shows the same
// ones at no cost and the chosen look stays put.

type Mode = "loading" | "where" | "looks" | "wearing" | "worn" | "limit";
const OFF = ["Colours", "Fit or shape", "Too dressy", "Too casual", "Costs too much", "Just not me"];
const SETTINGS = ["Outdoors", "Indoors", "Walking there", "Standing a lot"];

const SETTLED = "feta.style.settled";
const settleKey = (look: { id: string }) => `${new Date().toDateString()}|${look.id}`;
function settledFor() {
  try {
    return localStorage.getItem(SETTLED);
  } catch {
    return null;
  }
}

export default function Style() {
  const router = useRouter();
  const toast = useToast();
  const [origin] = useState(() => (typeof window === "undefined" ? null : loadOrigin()));
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [f, setF] = useState<LookFor | null>(null);
  const [set, setSet] = useState<LookSet | null>(null);
  const [li, setLi] = useState(0);
  const [anim, setAnim] = useState<"in" | "back" | "out" | "wear">("in");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<number | null>(null);
  const [swapping, setSwapping] = useState(false);
  const tried = useRef<Record<string, string[]>>({});
  const [from, setFrom] = useState<"plan" | "place" | null>(null); // a plan or place card opened Style
  // Where are you going?
  const [late, setLate] = useState(false);
  const [when, setWhen] = useState<"tonight" | "tomorrow" | null>(null);
  const [where, setWhere] = useState<Where | null>(null);
  const [place, setPlace] = useState("");
  const [setting, setSetting] = useState<string[]>([]);
  const [avoid, setAvoid] = useState("");
  const [own, setOwn] = useState("");
  const swipeX = useRef<number | null>(null);
  // Said "No, I'm set" to changing today's outfit: not asked again today
  // for that look (design audit, 26 Nov 2026), kept on the phone.
  const [settledNow, setSettledNow] = useState(false);

  const wears = profile?.wears ?? "women";
  const look = set && mode !== "where" ? (set.looks[mode === "wearing" || mode === "worn" ? (set.chosen ?? li) : Math.min(li, set.looks.length - 1)] ?? null) : null;
  // Each look's own picture (the outfit, never on them: founder, 25 Nov
  // 2026, a look made on her photo didn't keep her face) is made as it comes
  // on screen. Photos added for "On me" before leave the phone.
  const { pic, making, waiting } = useLookPicture(look, wears, !!look);
  useEffect(() => {
    forgetOnMe();
    try {
      localStorage.removeItem("feta.style.showAs");
    } catch {
      // Nothing kept.
    }
  }, []);

  async function openFor(next: LookFor) {
    setF(next);
    setLookFor(next);
    setMode("looks");
    setNotice(null);
    setLi(0);
    setAnim("in");
    // Waiting from the start, so the check for today's kept looks never
    // flashes "couldn't put looks together" (founder, 26 Nov 2026).
    setSet(null);
    setBusy(true);
    const day = next.tomorrow ? cityDay(1) : cityDay();
    const kept = await loadSet(day, next.key).catch(() => null);
    if (kept?.looks.length) {
      setSet(kept);
      setLi(keptIndex(kept));
      setBusy(false);
      return;
    }
    await make(next, day, 0, []);
  }

  async function make(next: LookFor, day: string, setNo: number, avoidLooks: string[]) {
    if (!origin) return setBusy(false);
    setBusy(true);
    let r = await newSet(next, day, origin.city.id, setNo, avoidLooks, origin.city);
    // One quiet retry before saying anything went wrong (founder, 23 Nov
    // 2026: "after Try again I got it… an error will ruin the experience").
    if (!r.set && !r.limited) r = await newSet(next, day, origin.city.id, setNo, avoidLooks, origin.city);
    setBusy(false);
    if (r.set) {
      setSet(r.set);
      setLi(0);
      setAnim("in");
      return;
    }
    setNotice(r.notice ?? "Feta couldn't put looks together just now.");
    if (r.limited) setMode("limit");
  }

  // Where they were in today's looks (after Brands or My style and back).
  const keptIndex = (x: LookSet) => {
    try {
      return Math.min(x.looks.length, Number(sessionStorage.getItem(`feta.style.li:${x.id}`) ?? 0) || 0);
    } catch {
      return 0;
    }
  };
  useEffect(() => {
    if (!set?.id) return;
    try {
      sessionStorage.setItem(`feta.style.li:${set.id}`, String(li));
    } catch {
      // Starts from the first look.
    }
  }, [set?.id, li]);

  useEffect(() => {
    (async () => {
      const p = await loadStyleProfile();
      if (!p?.styles.length) {
        router.replace("/style/setup");
        return;
      }
      setProfile(p);
      setLate(cityNow().hour >= 22);
      let came: string | null = null;
      try {
        came = sessionStorage.getItem(FROM_KEY);
      } catch {
        // From Home.
      }
      const fromCard = came === "plan" || came === "place";
      setFrom(fromCard ? (came as "plan" | "place") : null);
      const askWhere = new URLSearchParams(window.location.search).get("where") === "1";
      if (askWhere) return setMode("where");
      const chosen = chosenLookFor();
      const worn = await wornOn(cityDay());
      // The look they chose today stays put (testers, 23 Nov 2026: "You're
      // wearing" on Home opened new looks for an older plan). Only a tap on
      // "What to wear" on another plan or place opens that one instead.
      if (worn && worn.chosen !== null && (!fromCard || !chosen || chosen.key === worn.forKey)) {
        setSet(worn);
        setF(worn.forDetail ?? { key: worn.forKey, text: worn.forText, where: worn.forKey.startsWith("plan:") ? "plan" : ((worn.forKey.split(":")[0] as Where) ?? "day"), stops: [], walkKm: null });
        setLi(worn.chosen);
        setMode("wearing");
        return;
      }
      if (chosen) return openFor(chosen);
      const plan = await tonightPlan();
      if (plan) return openFor(lookForPlan(plan));
      setMode("where");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  if (!origin || !profile || mode === "loading")
    return (
      <>
        <main className={s.screen}>
          <div className={s.page}>
            <StyleHead tab="today" />
          </div>
        </main>
        <TabBar active="style" />
      </>
    );

  const p = profile;
  const owned = (name: string) => p.wardrobe.some((w) => w.toLowerCase() === name.toLowerCase()) || (!!f?.own && f.own.toLowerCase() === name.toLowerCase());
  const back = from && f?.where === "plan" ? () => router.back() : () => router.push("/home");
  const backLabel = from && f?.where === "plan" ? (from === "place" ? "Back" : "Back to your plan") : "Home";
  const country = origin.city.countryName;

  function next() {
    if (!set || li >= set.looks.length || anim === "out") return;
    setAnim("out");
    setTimeout(() => {
      setLi((i) => i + 1);
      setAnim("in");
    }, 280);
  }
  function prev() {
    if (li <= 0) return;
    setLi((i) => i - 1);
    setAnim("back");
  }
  function wear() {
    if (!set || li >= set.looks.length) return;
    setAnim("wear");
    setTimeout(async () => {
      await chooseLook(set, li);
      setSet({ ...set, chosen: li });
      setMode("worn");
      setAnim("in");
      toast("Saved to your Looks");
    }, 300);
  }
  async function more(note: string | null) {
    if (!set || !f) return;
    let nextP = p;
    if (note) {
      nextP = { ...p, offNotes: [...p.offNotes.filter((x) => x !== note), note] };
      setProfile(nextP);
      saveStyleProfile(nextP, origin!.city);
    }
    const shown = set.looks.map((l) => `${l.title}: ${l.pieces.map((x) => x.name).join(", ")}`);
    await make(f, set.day, set.setNo + 1, shown);
    if (note) toast(`${note}: noted. 3 new looks`);
  }
  function have(i: number) {
    if (!look) return;
    const name = look.pieces[i].name;
    setSheet(null);
    if (owned(name)) return;
    const nextP = { ...p, wardrobe: [...p.wardrobe, name] };
    setProfile(nextP);
    saveStyleProfile(nextP, origin!.city);
    toast("Added to your wardrobe");
  }
  async function swap(i: number) {
    if (!set || !look || !f || !origin) return;
    const key = `${set.id}:${li}:${i}`;
    const before = [...(tried.current[key] ?? []), look.pieces[i].name];
    tried.current[key] = before;
    setSwapping(true);
    const r = await swapInSet(set, f, origin.city.id, li, i, before);
    setSwapping(false);
    setSheet(null);
    if (r.set) {
      setSet(r.set);
      toast(`New ${r.set.looks[li].pieces[i].name.toLowerCase()}, the rest stays`);
    } else toast(r.notice ?? "Couldn't find another one just now.");
  }
  function buy(name: string) {
    if (!look) return;
    setSheet(null);
    router.push(`/style/brands?piece=${encodeURIComponent(name)}&style=${look.style}`);
  }
  function done() {
    if (from && f?.where === "plan") router.back();
    else router.push("/home");
  }
  function settle(l: { id: string }) {
    setSettledNow(true);
    try {
      localStorage.setItem(SETTLED, settleKey(l));
    } catch {
      // Asked again next time; that's all.
    }
  }
  // Browsing the others keeps today's look on until another is worn
  // (design audit, 26 Nov 2026: it came off at once, with no way back).
  function pickDifferent() {
    if (!set) return;
    setLi(0);
    setAnim("in");
    setMode("looks");
  }
  function changeWhere() {
    setWhere(null);
    setWhen(null);
    setMode("where");
  }
  function showLooks() {
    if (!where || (late && !when)) return;
    const tomorrow = when === "tomorrow";
    const label = WHERES.find((w) => w.id === where)!.label.replace("…", "");
    const evening = !tomorrow && cityNow().hour >= 15 && (where === "dinner" || where === "drinks");
    const text = where === "else" ? place.trim() || "Somewhere else" : `${label}${evening ? " tonight" : ""}`;
    const extra = where === "else" ? [place.trim(), setting.join("+"), avoid.trim()].join("|") : "";
    const next: LookFor = {
      key: `${where}${extra ? `:${extra}` : ""}${own.trim() ? `:own:${own.trim()}` : ""}${tomorrow ? ":tomorrow" : ""}`.slice(0, 200),
      text: `${tomorrow ? "Tomorrow · " : ""}${text}`,
      where,
      stops: [],
      walkKm: null,
      place: where === "else" ? place.trim() || undefined : undefined,
      setting: where === "else" ? setting : undefined,
      avoid: where === "else" ? avoid.trim() || undefined : undefined,
      own: own.trim() || undefined,
      tomorrow,
    };
    try {
      sessionStorage.removeItem(FROM_KEY);
    } catch {
      // Fine.
    }
    setFrom(null);
    openFor(next);
  }

  const total = set?.looks.length ?? 0;
  const whereBlocked = !where || (late && !when);

  return (
    <>
      <main className={`${s.screen} ${s.vars}`}>
        <div className={s.page}>
          <StyleHead tab="today" back={back} backLabel={backLabel} />

          {mode === "where" && (
            <>
              <h1 className={s.mast}>
                Where are you <i>going?</i>
              </h1>
              {late && (
                <div className={k.fold}>
                  <span className={k.why}>It&apos;s {cityNow().clock}. Is this for tonight, or tomorrow?</span>
                  <div className={k.chips}>
                    {(["tonight", "tomorrow"] as const).map((w) => (
                      <button key={w} type="button" className={`${k.chip} ${when === w ? k.chipOn : ""}`} aria-pressed={when === w} onClick={() => setWhen(w)}>
                        {w === "tonight" ? "Tonight" : "Tomorrow"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className={k.chips}>
                {WHERES.map((w) => (
                  <button key={w.id} type="button" className={`${k.chip} ${where === w.id ? k.chipOn : ""}`} aria-pressed={where === w.id} onClick={() => setWhere(w.id)}>
                    {w.label}
                  </button>
                ))}
              </div>
              {where === "else" && (
                <div className={k.fold}>
                  <label className={k.label} htmlFor="st-where">
                    Where?
                  </label>
                  <input id="st-where" className={k.field} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. a rooftop gig, a wedding lunch" maxLength={160} />
                  <div className={k.chips}>
                    {SETTINGS.map((x) => {
                      const on = setting.includes(x);
                      return (
                        <button key={x} type="button" className={`${k.chip} ${on ? k.chipOn : ""}`} aria-pressed={on} onClick={() => setSetting(on ? setting.filter((y) => y !== x) : [...setting, x])}>
                          {x}
                        </button>
                      );
                    })}
                  </div>
                  <label className={k.label} htmlFor="st-avoid">
                    Anything to avoid?
                  </label>
                  <input id="st-avoid" className={k.field} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="e.g. no heels, covered shoulders" maxLength={160} />
                </div>
              )}
              <label className={k.label} htmlFor="st-own" style={{ marginTop: 6 }}>
                Wearing something of your own? (optional)
              </label>
              <input id="st-own" className={k.field} value={own} onChange={(e) => setOwn(e.target.value)} placeholder="e.g. my black boots" maxLength={80} />
              <button type="button" className={k.primary} disabled={whereBlocked} onClick={showLooks} style={{ marginTop: 8 }}>
                {whereBlocked ? (late && !when ? "Tonight or tomorrow?" : "Where are you going?") : "Show my looks ›"}
              </button>
              {set && f && (
                <button type="button" className={k.ghost} onClick={() => setMode(set.chosen !== null ? "wearing" : "looks")}>
                  {set.chosen !== null ? "Keep what I'm wearing" : <>Back to {f.text.toLowerCase().startsWith("tomorrow") ? f.text : `“${f.text}”`}</>}
                </button>
              )}
            </>
          )}

          {mode !== "where" && f && (
            <button type="button" className={k.forRow} onClick={changeWhere}>
              <span>
                For <b>{f.text}</b>
              </span>
              <span className={k.change}>{f.where === "plan" ? "Not this plan?" : "Change"}</span>
            </button>
          )}

          {mode === "looks" && !set && (
            <div className={k.card} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 20 }}>
              {busy ? (
                <>
                  <Mascot pose="think" size={80} prop="shades" />
                  <WaitFun kind="look" compact onLight />
                </>
              ) : (
                <>
                  <span style={{ textAlign: "center", fontSize: 15 }}>{notice ?? "Feta couldn't put looks together just now."}</span>
                  <button type="button" className={k.chipD} onClick={() => f && openFor(f)}>
                    Try again
                  </button>
                </>
              )}
            </div>
          )}

          {mode === "looks" && set && look && li < total && (
            <>
              <div className={k.lookHead}>
                <span className={k.lookTitle}>{look.title}</span>
                <span className={k.count}>
                  {li + 1} of {total}
                </span>
              </div>
              <span className={k.styleLine}>{styleById(look.style)?.name ?? ""}</span>
              <div
                key={`${set.id}-${li}`}
                className={`${k.deck} ${anim === "out" ? k.walkOut : anim === "wear" ? k.wearOut : anim === "back" ? k.walkBack : k.walkIn}`}
                onPointerDown={(e) => (swipeX.current = e.clientX)}
                onPointerUp={(e) => {
                  const x = swipeX.current;
                  swipeX.current = null;
                  if (x === null) return;
                  const dx = e.clientX - x;
                  if (dx < -60) next();
                  else if (dx > 60) wear();
                }}
                onPointerCancel={() => (swipeX.current = null)}
              >
                <LookCard look={look} wears={wears} pic={pic} making={making} waiting={waiting} owned={owned} onPiece={setSheet} />
              </div>
              <div className={k.actions}>
                <button type="button" className={k.round} aria-label="The last look" onClick={prev} disabled={li === 0}>
                  ‹
                </button>
                <button type="button" className={k.round} aria-label="Next look" onClick={next}>
                  ✕
                </button>
                <button type="button" className={k.wear} onClick={wear}>
                  Wear this
                </button>
              </div>
              <div className={k.hint}>
                <span>← Swipe to skip</span>
                <span>Swipe to wear →</span>
              </div>
              <p className={k.why}>{look.why}</p>
              {set.chosen !== null && (
                <button type="button" className={k.ghost} onClick={() => setMode("wearing")}>
                  Keep what I&apos;m wearing
                </button>
              )}
            </>
          )}

          {mode === "looks" && set && li >= total && (
            <>
              <div className={k.endCard}>
                <h2>Seen all {total}.</h2>
                <span style={{ fontSize: 15, opacity: 0.75 }}>What&apos;s off? Feta changes it for the next 3, and remembers it.</span>
                {busy ? (
                  <WaitFun kind="look" compact onLight />
                ) : (
                  <>
                    <div className={k.chipsD}>
                      {OFF.map((o) => (
                        <button key={o} type="button" className={k.chipD} onClick={() => more(o)}>
                          {o}
                        </button>
                      ))}
                    </div>
                    <button type="button" className={`${k.chipD} ${k.chipDark}`} style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={() => more(null)}>
                      Just show 3 more
                    </button>
                    {notice && <span style={{ fontSize: 13 }}>{notice}</span>}
                  </>
                )}
              </div>
              <div className={k.actions}>
                <button type="button" className={k.round} aria-label="The last look" onClick={prev}>
                  ‹
                </button>
                <span />
                <span />
              </div>
            </>
          )}

          {mode === "wearing" && set && look && (
            <>
              <div className={k.lookHead}>
                <span className={k.lookTitle}>{look.title}</span>
                <span className={k.count}>Today</span>
              </div>
              <span className={k.styleLine}>{styleById(look.style)?.name ?? ""}</span>
              <div className={k.deck}>
                <LookCard look={look} wears={wears} pic={pic} making={making} waiting={waiting} owned={owned} onPiece={setSheet} pill="✓ You're wearing this" />
              </div>
              {/* Coming back, Feta asks before changing anything (founder, 25 Nov
                  2026: "it should ideally ask me if i wanna change my outfit"). */}
              {/* "No, I'm set" says so out loud (founder, 26 Nov 2026). */}
              {settledNow || settledFor() === settleKey(look) ? (
                <p className={k.why} style={{ textAlign: "center" }}>Enjoy it.</p>
              ) : (
                <>
                  <p className={k.why} style={{ textAlign: "center" }}>Changing your outfit?</p>
                  <button type="button" className={k.primary} onClick={changeWhere}>
                    Yes, where are you going?
                  </button>
                  <button type="button" className={k.ghost} onClick={() => settle(look)}>
                    No, I&apos;m set
                  </button>
                  <button type="button" className={k.ghost} onClick={pickDifferent}>
                    Or pick another of today&apos;s looks
                  </button>
                </>
              )}
            </>
          )}

          {mode === "worn" && set && look && (
            <>
              <div className={k.wornPol}>
                <div className={k.pic}>
                  {pic ? (
                    // eslint-disable-next-line @next/next/no-img-element -- kept on this phone
                    <img src={pic} alt="" style={{ inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
                  ) : (
                    <StyleFigure style={look.style} wears={wears} imgStyle={{ top: 0, height: "100%" }} />
                  )}
                </div>
                <i>{look.title}</i>
              </div>
              <h1 className={s.mast} style={{ marginBottom: 0 }}>
                You&apos;re wearing <i>this.</i>
              </h1>
              <p className={k.why}>
                Saved to your Looks{f?.where === "plan" ? ", and on your plan" : ""}. Home shows it until the day ends. Which of these do you have?
              </p>
              <div className={k.rows}>
                {look.pieces.map((x, i) => (
                  <div key={i} className={k.rowItem}>
                    <span>{owned(x.name) ? `Your ${x.name.toLowerCase()}` : x.name}</span>
                    {owned(x.name) ? (
                      <span className={k.yours}>✓ Yours</span>
                    ) : (
                      <span style={{ display: "flex", gap: 6, flex: "none" }}>
                        <button type="button" className={k.mini} onClick={() => have(i)}>
                          I have it
                        </button>
                        <button type="button" className={k.mini} style={{ color: "var(--tan)" }} onClick={() => buy(x.name)}>
                          Buy ›
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className={k.primary} onClick={done}>
                Done
              </button>
            </>
          )}

          {mode === "limit" && (
            <>
              <div className={k.card}>
                <div className={k.fig}>
                  <StyleFigure style={p.styles[0]} wears={wears} imgStyle={{ top: 0, height: "100%", filter: "grayscale(0.2)" }} />
                </div>
                <div style={{ position: "absolute", left: "60%", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 14, fontWeight: 500 }}>
                  Your go-to: <b>{styleById(p.styles[0])?.name}</b>
                </div>
              </div>
              <div className={k.note}>{notice ?? "That's all the new looks for today."}</div>
              <button type="button" className={k.ghost} onClick={() => router.push("/style/me")}>
                Looks you wore
              </button>
            </>
          )}
        </div>
      </main>
      {sheet !== null && look && (
        <PieceSheet
          name={look.pieces[sheet].name}
          look={look}
          wears={wears}
          pic={pic}
          mine={owned(look.pieces[sheet].name)}
          budgetText={`Brands in ${country}, within your budget`}
          swapping={swapping}
          onClose={() => setSheet(null)}
          onHave={() => have(sheet)}
          onSwap={() => swap(sheet)}
          onBuy={() => buy(look.pieces[sheet].name)}
        />
      )}
      {mode === "where" || mode === "limit" ? <TabBar active="style" /> : null}
    </>
  );
}
