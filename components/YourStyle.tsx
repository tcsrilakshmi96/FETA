"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { knownCurrency } from "@/lib/currency";
import { loadOrigin } from "@/lib/origin";
import { loadWants } from "@/lib/profile";
import { BUDGET_LEVELS, BUDGET_NAMES, budgetLabels, styleById, type Wears } from "@/lib/style";
import { loadLovedBrands, loadStyleProfile, loveBrand, saveStyleProfile, type LovedBrand, type StyleProfile } from "@/lib/style-client";
import styles from "./YourTaste.module.css";

// Style in You (founder, 20 Nov 2026: Style felt like a separate app, and
// its choices couldn't be seen or changed where everything else is). The
// same card as Food & drinks: rules Feta always follows (what they shop for,
// clothes budget, Homegrown only) set with a tap, their styles and the
// brands they love as chips, every change saved at once.
type Open = "wears" | "budget" | "homegrown" | null;
const WEARS: [Wears, string][] = [
  ["women", "Womenswear"],
  ["men", "Menswear"],
  ["both", "Both"],
];

export default function YourStyle() {
  const router = useRouter();
  const [profile, setProfile] = useState<StyleProfile | null | undefined>(undefined);
  const [loved, setLoved] = useState<LovedBrand[]>([]);
  const [open, setOpen] = useState<Open>(null);
  const [saved, setSaved] = useState(false);
  const [wanted, setWanted] = useState(false);
  const [origin] = useState(() => (typeof window === "undefined" ? null : loadOrigin()));
  const currency = knownCurrency(origin?.city.currency);

  useEffect(() => {
    loadStyleProfile().then(setProfile);
    loadLovedBrands().then(setLoved);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from the phone
    setWanted(loadWants().includes("style"));
  }, []);

  if (profile === undefined) return null;
  if (!profile) {
    if (!wanted) return null;
    return (
      <section className={styles.card}>
        <h2>Style</h2>
        <p className={styles.label}>Show Feta a few outfits you love and it learns what you wear, then suggests looks for your plans and brands for your style.</p>
        <button type="button" className={styles.link} onClick={() => router.push("/style")}>
          Set up Style ›
        </button>
      </section>
    );
  }

  function change(p: StyleProfile) {
    setProfile(p);
    saveStyleProfile(p, origin?.city ?? null).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  const labels = budgetLabels(currency);
  const budgetText = profile.budget.length ? profile.budget.map((b) => BUDGET_NAMES[BUDGET_LEVELS.indexOf(b as (typeof BUDGET_LEVELS)[number])]).join(", ") : "Not set";
  const row = (id: Exclude<Open, null>, name: string, value: string) => (
    <button type="button" className={styles.rule} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
      <span>{name}</span>
      <b>
        {value} <i aria-hidden="true">›</i>
      </b>
    </button>
  );

  return (
    <section className={styles.card}>
      <h2>Style</h2>
      <p className={styles.label}>Feta always follows</p>
      <div className={styles.rules}>
        <div>
          {row("wears", "Shops for", WEARS.find(([w]) => w === profile.wears)?.[1] ?? "")}
          {open === "wears" && (
            <div className={styles.picker}>
              <span className={styles.chips}>
                {WEARS.map(([w, label]) => (
                  <button key={w} type="button" className={styles.chip} aria-pressed={profile.wears === w} onClick={() => change({ ...profile, wears: w })}>
                    {label}
                  </button>
                ))}
              </span>
            </div>
          )}
        </div>
        <div>
          {row("budget", "Clothes budget", budgetText)}
          {open === "budget" && (
            <div className={styles.picker}>
              <span className={styles.chips}>
                {BUDGET_LEVELS.map((id, i) => {
                  const on = profile.budget.includes(id);
                  return (
                    <button key={id} type="button" className={styles.chip} aria-pressed={on} onClick={() => change({ ...profile, budget: on ? profile.budget.filter((b) => b !== id) : [...profile.budget, id] })}>
                      {BUDGET_NAMES[i]} · {labels[i]}
                    </button>
                  );
                })}
              </span>
            </div>
          )}
        </div>
        <div>
          {row("homegrown", "Homegrown only", profile.homegrownOnly ? "On" : "Off")}
          {open === "homegrown" && (
            <div className={styles.picker}>
              <span className={styles.chips}>
                {[true, false].map((v) => (
                  <button key={String(v)} type="button" className={styles.chip} aria-pressed={profile.homegrownOnly === v} onClick={() => change({ ...profile, homegrownOnly: v })}>
                    {v ? `Only labels started in ${origin?.city.countryName ?? "your country"}` : "Homegrown and international"}
                  </button>
                ))}
              </span>
            </div>
          )}
        </div>
      </div>

      <p className={styles.label}>Your styles</p>
      <span className={styles.chips}>
        {profile.styles.map((id) => (
          <button
            key={id}
            type="button"
            className={styles.chip}
            aria-pressed="true"
            aria-label={`Remove ${styleById(id)?.name}`}
            disabled={profile.styles.length === 1}
            onClick={() => change({ ...profile, styles: profile.styles.filter((s) => s !== id) })}
          >
            {styleById(id)?.short} ✕
          </button>
        ))}
      </span>
      <button type="button" className={styles.link} onClick={() => router.push("/style/me")}>
        Add or change styles ›
      </button>

      <p className={styles.label}>Brands you love</p>
      {loved.length > 0 && (
        <span className={styles.chips}>
          {loved.map((b) => (
            <button
              key={b.id}
              type="button"
              className={styles.chip}
              aria-label={`Remove ${b.name}`}
              onClick={() => {
                setLoved(loved.filter((x) => x.id !== b.id));
                loveBrand(b.id, false);
              }}
            >
              {b.name} ✕
            </button>
          ))}
        </span>
      )}
      <button type="button" className={styles.link} onClick={() => router.push("/style/me")}>
        {loved.length ? "Add a brand ›" : "Add brands you love ›"}
      </button>
      <button type="button" className={styles.link} onClick={() => router.push("/style/setup?step=1&from=me")}>
        Show Feta new outfit photos ›
      </button>
      {saved && <p className={styles.label}>Saved</p>}
    </section>
  );
}
