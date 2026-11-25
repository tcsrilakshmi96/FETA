"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StyleFigure, StyleHead } from "@/components/StyleKit";
import { Logo } from "@/components/StyleParts";
import TabBar from "@/components/TabBar";
import { useToast } from "@/components/Toast";
import { knownCurrency } from "@/lib/currency";
import { loadOrigin } from "@/lib/origin";
import { BUDGET_LEVELS, BUDGET_NAMES, budgetLabels, styleById, type Wears } from "@/lib/style";
import { forgetOnMe, keptPicture, loadLovedBrands, loadStyleProfile, lookupNewBrand, loveBrand, recommendSetting, saveStyleProfile, searchBrands, setRecommendBrands, wearAgain, wornLooks, type LookSet, type LovedBrand, type StyleProfile } from "@/lib/style-client";
import k from "./StyleLook.module.css";
import s from "./StyleScreens.module.css";

// My style (founder, 22–23 Nov 2026, docs/style-spec.md): one page, every
// row edited in place and saved at once, never the setup steps again (the
// UX review: Back walked through setup and step 1 showed empty pegs).
// What they shop for · their styles · wardrobe · budget · looks they wore
// (Wear it again) · brands they shop from (recommended to people with a
// similar taste if they choose) · looks on them (their photo, on this phone).
const WEARS: [Wears, string][] = [
  ["women", "Womenswear"],
  ["men", "Menswear"],
  ["both", "Both"],
];

export default function StyleMine() {
  const router = useRouter();
  const toast = useToast();
  const [origin] = useState(() => (typeof window === "undefined" ? null : loadOrigin()));
  const [p, setP] = useState<StyleProfile | null>(null);
  const [worn, setWorn] = useState<LookSet[]>([]);
  const [pics, setPics] = useState<Record<string, string | null>>({});
  const [usuals, setUsuals] = useState<LovedBrand[]>([]);
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; logo: string | null }[]>([]);
  const [looking, setLooking] = useState(false);
  const [piece, setPiece] = useState("");
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    loadStyleProfile().then((x) => {
      if (!x?.styles.length) {
        router.replace("/style/setup");
        return;
      }
      setP(x);
    });
    wornLooks().then(async (list) => {
      setWorn(list);
      const all = await Promise.all(list.map(async (w) => [w.id, (await keptPicture(w.looks[w.chosen ?? 0]))?.image ?? null] as const));
      setPics(Object.fromEntries(all));
    });
    loadLovedBrands().then(setUsuals);
    recommendSetting().then(setRecommend);
    // "On me" is gone for now (founder, 25 Nov 2026): a photo added before leaves the phone.
    forgetOnMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  // Brands in the library as they type.
  useEffect(() => {
    const t = setTimeout(() => searchBrands(query).then(setFound), 200);
    return () => clearTimeout(t);
  }, [query]);

  if (!p || !origin) return null;
  const labels = budgetLabels(knownCurrency(origin.city.currency));

  function change(next: StyleProfile, note?: string) {
    setP(next);
    saveStyleProfile(next, origin!.city).then(() => setSaved((n) => n + 1));
    if (note) toast(note);
  }

  async function addBrand(b: { id: string; name: string; logo: string | null }) {
    setQuery("");
    setFound([]);
    if (usuals.some((x) => x.id === b.id)) return;
    await loveBrand(b.id, true, { recommend: recommend ?? true, country: origin!.city.country });
    if (recommend === null) setRecommend(true);
    setUsuals(await loadLovedBrands());
    toast(`${b.name} added to your usuals`);
  }

  async function addNew() {
    const name = query.trim();
    if (name.length < 2) return;
    setLooking(true);
    const r = await lookupNewBrand(name, origin!.city.id);
    setLooking(false);
    if (r?.brand) await addBrand({ ...r.brand, logo: null });
    else toast(r?.notice ?? "Couldn't find that brand.");
  }

  async function again(w: LookSet) {
    const look = w.looks[w.chosen ?? 0];
    await wearAgain(look, origin!.city);
    toast("Wearing it again today");
    router.push("/style");
  }

  const addPiece = () => {
    const name = piece.trim();
    if (name.length < 2 || p.wardrobe.some((x) => x.toLowerCase() === name.toLowerCase())) return;
    setPiece("");
    change({ ...p, wardrobe: [...p.wardrobe, name] }, "Added to your wardrobe");
  };

  return (
    <>
      <main className={`${s.screen} ${s.vars}`}>
        <div className={s.page}>
          <StyleHead tab="me" />
          <div className={k.boxHead}>
            <span style={{ fontSize: 13.5, opacity: 0.75 }}>Change anything. It saves as you go.</span>
            {saved > 0 && (
              <span key={saved} className={k.saved}>
                Saved
              </span>
            )}
          </div>

          <section className={k.box}>
            <span className={k.label}>You shop</span>
            <div className={k.chips}>
              {WEARS.map(([w, label]) => (
                <button key={w} type="button" className={`${k.chip} ${p.wears === w ? k.chipOn : ""}`} aria-pressed={p.wears === w} onClick={() => p.wears !== w && change({ ...p, wears: w }, `Every look now shows ${label.toLowerCase()}`)}>
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className={k.box}>
            <span className={k.label}>Your styles</span>
            <div className={k.thumbs3}>
              {p.styles.map((id) => (
                <div key={id} className={k.thumb}>
                  <span className={k.thumbImg}>
                    <StyleFigure style={id} wears={p.wears} />
                  </span>
                  {p.styles.length > 1 && (
                    <button type="button" className={k.thumbX} aria-label={`Remove ${styleById(id)?.name}`} onClick={() => change({ ...p, styles: p.styles.filter((x) => x !== id) }, `${styleById(id)?.short} removed`)}>
                      ✕
                    </button>
                  )}
                  {styleById(id)?.short}
                </div>
              ))}
            </div>
            <button type="button" className={k.mini} style={{ alignSelf: "flex-start" }} onClick={() => router.push("/style/setup?step=1&from=me")}>
              + Add styles or photos
            </button>
          </section>

          <section className={k.box}>
            <span className={k.label}>Your wardrobe · {p.wardrobe.length} {p.wardrobe.length === 1 ? "piece" : "pieces"}</span>
            {p.wardrobe.length > 0 && (
              <div className={k.chips}>
                {p.wardrobe.map((w) => (
                  <button key={w} type="button" className={`${k.chip} ${k.chipOn}`} aria-label={`Remove ${w}`} onClick={() => change({ ...p, wardrobe: p.wardrobe.filter((x) => x !== w) })}>
                    {w} ✕
                  </button>
                ))}
              </div>
            )}
            <form
              style={{ display: "flex", gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                addPiece();
              }}
            >
              <input className={k.field} value={piece} onChange={(e) => setPiece(e.target.value)} placeholder="Add a piece, e.g. black ankle boots" aria-label="Add a piece you own" maxLength={48} />
              <button type="submit" className={k.mini} disabled={piece.trim().length < 2}>
                Add
              </button>
            </form>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Grows each time you tap &ldquo;I have one&rdquo;. Looks use these first.</span>
          </section>

          <section className={k.box}>
            <span className={k.label}>Most you&apos;d spend on one piece</span>
            <div className={k.chips}>
              {BUDGET_LEVELS.map((id, i) => {
                const on = p.budget.includes(id);
                return (
                  <button key={id} type="button" className={`${k.chip} ${on ? k.chipOn : ""}`} aria-pressed={on} onClick={() => (on && p.budget.length === 1 ? null : change({ ...p, budget: on ? p.budget.filter((b) => b !== id) : [...p.budget, id] }))}>
                    {BUDGET_NAMES[i]} · {labels[i]}
                  </button>
                );
              })}
            </div>
          </section>

          <section className={k.box}>
            <span className={k.label}>Looks you wore</span>
            {worn.length ? (
              <div className={k.thumbs3}>
                {worn.map((w) => {
                  const look = w.looks[w.chosen ?? 0];
                  if (!look) return null;
                  const pic = pics[w.id];
                  return (
                    <div key={w.id} className={k.thumb}>
                      <span className={k.thumbImg}>
                        {pic ? (
                          // eslint-disable-next-line @next/next/no-img-element -- kept on this phone
                          <img src={pic} alt="" style={{ inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
                        ) : (
                          <StyleFigure style={look.style} wears={p.wears} />
                        )}
                      </span>
                      <span style={{ fontWeight: 600 }}>{look.title}</span>
                      <span style={{ opacity: 0.65 }}>{new Date(`${w.day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}</span>
                      <button type="button" className={k.mini} onClick={() => again(w)}>
                        Wear it again
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <span style={{ fontSize: 13, opacity: 0.7 }}>Looks you choose with Wear this collect here.</span>
            )}
          </section>

          <section className={k.box} id="brands">
            <span className={k.label}>Brands you shop from</span>
            {usuals.length > 0 && (
              <div className={k.chips}>
                {usuals.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`${k.chip} ${k.chipOn}`}
                    aria-label={`Remove ${b.name}`}
                    onClick={async () => {
                      await loveBrand(b.id, false);
                      setUsuals(usuals.filter((x) => x.id !== b.id));
                    }}
                  >
                    ♥ {b.name} ✕
                  </button>
                ))}
              </div>
            )}
            <div style={{ position: "relative" }}>
              <input className={k.field} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add a brand, e.g. Uniqlo" aria-label="Add a brand you shop from" maxLength={60} />
              {query.trim().length >= 2 && (
                <div className={s.results}>
                  {found.map((b) => (
                    <button key={b.id} type="button" className={s.result} onClick={() => addBrand(b)}>
                      <Logo name={b.name} src={b.logo} />
                      <span>{b.name}</span>
                    </button>
                  ))}
                  {!found.some((b) => b.name.toLowerCase() === query.trim().toLowerCase()) && (
                    <button type="button" className={s.result} onClick={addNew} disabled={looking}>
                      <span className={s.logo} aria-hidden="true">＋</span>
                      <span>{looking ? `Looking up “${query.trim()}”…` : `Add “${query.trim()}”: Feta looks it up once`}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className={k.switchRow}
              aria-pressed={recommend !== false}
              onClick={() => {
                const next = recommend === false;
                setRecommend(next);
                setRecommendBrands(next);
                toast(next ? "Recommended to people with your taste" : "Your brands stay with you");
              }}
            >
              <span>
                <b style={{ fontSize: 14 }}>Recommend them to people with your taste</b>
                <span style={{ display: "block", fontSize: 12, opacity: 0.7 }}>They&apos;d see &ldquo;♥ Loved by people with your taste&rdquo;. Never your name.</span>
              </span>
              <span className={`${k.switch} ${recommend !== false ? k.switchOn : ""}`}>
                <span />
              </span>
            </button>
          </section>

        </div>
      </main>
      <TabBar active="style" />
    </>
  );
}
