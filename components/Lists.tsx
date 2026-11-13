"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AddPlace from "@/components/AddPlace";
import TabBar from "@/components/TabBar";
import { useToast } from "@/components/Toast";
import { markBeen, removeFromList, saveListNote } from "@/lib/db";
import { fetchLists, type ListItem } from "@/lib/lists-client";
import { formatDistance } from "@/lib/cities";
import { loadOrigin, type Origin } from "@/lib/origin";
import { saveBeen, VERDICTS, VISITS, type Verdict, type Visits } from "@/lib/my-places";
import { addWeekendWish, loadWishes, removeWeekendWish, thisSaturday, tickWeekend, type Wish } from "@/lib/weekend-client";
import styles from "./Lists.module.css";

type Tab = "want" | "been";

function savedLabel(item: ListItem) {
  if (item.event) return "Event";
  // "Been" has no date: marking it doesn't say when they went. It shows
  // how it was and how often, when they've said.
  if (item.list === "been") {
    const parts = [VERDICTS.find((v) => v.id === item.verdict)?.label, item.visits === "regular" ? "Regular" : item.visits === "few" ? "A few times" : null];
    return parts.filter(Boolean).join(" · ") || "Been ✓";
  }
  const days = Math.floor(
    (Date.now() - new Date(item.savedAt).getTime()) / 86400000,
  );
  const verb = "Saved";
  if (days < 1) return `${verb} today`;
  if (days < 7)
    return `${verb} ${new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(new Date(item.savedAt))}`;
  return `${verb} ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(item.savedAt))}`;
}

export default function Lists() {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("want");
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [open, setOpen] = useState<ListItem | null>(null);
  const [note, setNote] = useState("");
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [wish, setWish] = useState("");
  const [adding, setAdding] = useState(false);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [saturday, setSaturday] = useState("");

  // Lists refresh each time the screen is shown.
  useEffect(() => {
    let live = true;
    const here = loadOrigin();
    /* eslint-disable react-hooks/set-state-in-effect -- the city is only readable in the browser */
    setOrigin(here);
    setSaturday(thisSaturday());
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchLists(here).then((list) => live && setItems(list ?? []));
    loadWishes().then((w) => live && setWishes(w));
    return () => {
      live = false;
    };
  }, []);

  const shown = (items ?? []).filter((i) => i.list === tab);
  const action = (i: ListItem) => (i.list === "been" ? "been" : "saved");

  function openItem(item: ListItem) {
    setOpen(item);
    setNote(item.note);
  }

  function update(placeId: string, list: Tab, patch: Partial<ListItem> | null) {
    setItems((all) =>
      (all ?? []).flatMap((i) =>
        i.placeId === placeId && i.list === list
          ? patch
            ? [{ ...i, ...patch }]
            : []
          : [i],
      ),
    );
  }

  function saveNote() {
    if (!open) return;
    saveListNote(open.placeId, action(open), note);
    update(open.placeId, open.list, { note: note.trim() });
    setOpen(null);
    toast("Note saved");
  }

  function been() {
    if (!open) return;
    markBeen(open.placeId, note);
    update(open.placeId, "want", {
      list: "been",
      note: note.trim(),
      savedAt: new Date().toISOString(),
    });
    setOpen(null);
    toast("Moved to Been");
  }

  function remove() {
    if (!open) return;
    removeFromList(open.placeId, action(open));
    update(open.placeId, open.list, null);
    setOpen(null);
    toast("Removed");
  }

  const ticked = (items ?? []).filter((i) => i.list === "want" && i.weekendFor === saturday);
  const isTicked = (i: ListItem) => i.list === "want" && i.weekendFor === saturday;

  function toggleWeekend(item: ListItem) {
    const on = !isTicked(item);
    tickWeekend(item.placeId, on);
    update(item.placeId, "want", { weekendFor: on ? saturday : null });
    setOpen((o) => o && { ...o, weekendFor: on ? saturday : null });
    toast(on ? "On your weekend list" : "Off your weekend list");
  }

  async function addWish(e: React.FormEvent) {
    e.preventDefault();
    const text = wish.trim();
    if (!text) return;
    setWish("");
    const saved = await addWeekendWish(text);
    if (saved) setWishes((w) => [...w, saved]);
    else toast("Couldn't add that just now. Try again.");
  }

  return (
    <>
      <main className={styles.screen}>
        <h1 className={styles.title}>
          <strong>Saved</strong>
        </h1>
        <div className={styles.segment} role="tablist">
          <span
            className={styles.thumb}
            style={{ transform: tab === "want" ? "none" : "translateX(110px)" }}
          />
          <button
            type="button"
            role="tab"
            aria-selected={tab === "want"}
            className={`${styles.segBtn} ${tab === "want" ? styles.segOn : ""}`}
            onClick={() => setTab("want")}
          >
            Want to try
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "been"}
            className={`${styles.segBtn} ${tab === "been" ? styles.segOn : ""}`}
            onClick={() => setTab("been")}
          >
            Been
          </button>
        </div>
        <p className={styles.private}>Private. Only you can see these.</p>

        {tab === "been" && items !== null && (
          <button type="button" className={styles.addPlace} onClick={() => setAdding(true)}>
            <span>＋</span>
            <span>
              <strong>Add a place you&apos;ve been</strong>
              <span>Your favourites and regulars teach Feta most.</span>
            </span>
          </button>
        )}

        {/* This weekend shows once something is on it (testers: Lists had too much going on). */}
        {tab === "want" && items !== null && (ticked.length > 0 || wishes.length > 0) && (
          <section className={styles.weekend}>
            <p className={styles.wkLabel}>THIS WEEKEND</p>
            {(ticked.length > 0 || wishes.length > 0) && (
              <ul className={styles.wkChips}>
                {ticked.map((i) => (
                  <li key={i.placeId}>
                    <button type="button" className={styles.wkChip} onClick={() => openItem(i)}>
                      ✓ {i.name}
                    </button>
                  </li>
                ))}
                {wishes.map((w) => (
                  <li key={w.id}>
                    <span className={styles.wkChip}>
                      {w.text}
                      <button
                        type="button"
                        className={styles.wkRemove}
                        aria-label={`Remove ${w.text}`}
                        onClick={() => {
                          removeWeekendWish(w.id);
                          setWishes((all) => all.filter((x) => x.id !== w.id));
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form className={styles.wkForm} onSubmit={addWish}>
              <input
                value={wish}
                onChange={(e) => setWish(e.target.value)}
                placeholder="e.g. pottery with my sister, brunch somewhere new"
                aria-label="Something you want to do this weekend"
                maxLength={80}
              />
              <button type="submit" disabled={!wish.trim()}>
                Add
              </button>
            </form>
          </section>
        )}

        {items === null && (
          <p className={styles.loading}>Getting your places…</p>
        )}

        {items !== null && shown.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>
              Nothing here <strong>yet.</strong>
            </p>
            <p className={styles.emptyText}>
              {tab === "want"
                ? "Swipe right on a pick, or tap ♥, and it lands here with room for a note."
                : "When you've been somewhere you saved, open it and tap I've been."}
            </p>
            {tab === "want" && (
              <button
                type="button"
                className={styles.emptyBtn}
                onClick={() => router.push("/home")}
              >
                See tonight&apos;s picks
              </button>
            )}
          </div>
        )}

        {shown.length > 0 && (
          <>
            <ul className={styles.items}>
              {shown.map((item, i) => (
                <li
                  key={`${item.list}:${item.placeId}`}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <button
                    type="button"
                    className={styles.item}
                    onClick={() => openItem(item)}
                  >
                    <span className={styles.pic}>
                      {item.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.photo}
                          alt=""
                          referrerPolicy="no-referrer"
                        />
                      )}
                    </span>
                    <span className={styles.text}>
                      <span className={styles.row}>
                        <span className={styles.name}>{item.name}</span>
                        <span className={styles.when}>{isTicked(item) ? "This weekend ✓" : savedLabel(item)}</span>
                      </span>
                      <span
                        className={styles.area}
                        style={{ display: "block" }}
                      >
                        {[
                          item.area,
                          item.distanceKm !== null && formatDistance(item.distanceKm, origin?.city.country),
                          item.event?.when,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span
                        className={`${styles.note} ${item.note ? "" : styles.noteEmpty}`}
                        style={{ display: "block" }}
                      >
                        {item.note ? `Note: ${item.note}` : "Add a note"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className={styles.end}>That&apos;s everything.</p>
          </>
        )}

      </main>
      <TabBar active="lists" />
      {adding && origin && (
        <AddPlace
          city={origin.city}
          onClose={() => setAdding(false)}
          onAdded={(p) => {
            setAdding(false);
            setItems((all) => [
              {
                placeId: p.placeId,
                list: "been",
                name: p.name,
                area: p.detail.split(",")[0],
                distanceKm: null,
                note: p.note,
                savedAt: new Date().toISOString(),
                weekendFor: null,
                visits: p.visits,
                verdict: p.verdict,
                mapsUri: `https://www.google.com/maps/place/?q=place_id:${p.placeId}`,
                photo: null,
              },
              ...(all ?? []).filter((i) => !(i.placeId === p.placeId && i.list === "been")),
            ]);
            toast(`${p.name} added. Feta will learn from it.`);
          }}
        />
      )}
      {open && (
        <>
          <div className={styles.dim} onClick={() => setOpen(null)} />
          <div className={styles.sheet} role="dialog" aria-label={open.name}>
            <h2 className={styles.sheetTitle}>{open.name}</h2>
            <p className={styles.sheetSub}>
              {[
                open.area,
                open.distanceKm !== null && formatDistance(open.distanceKm, origin?.city.country),
                open.event?.when,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {open.list === "been" && (
              <div className={styles.rate}>
                <div className={styles.rateRow}>
                  {VERDICTS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={open.verdict === v.id ? styles.rateOn : ""}
                      onClick={() => {
                        saveBeen(open.placeId, { verdict: v.id as Verdict });
                        update(open.placeId, "been", { verdict: v.id });
                        setOpen({ ...open, verdict: v.id });
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <div className={styles.rateRow}>
                  {VISITS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={open.visits === v.id ? styles.rateOn : ""}
                      onClick={() => {
                        saveBeen(open.placeId, { visits: v.id as Visits });
                        update(open.placeId, "been", { visits: v.id });
                        setOpen({ ...open, visits: v.id });
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {open.list === "want" && (
              <button
                type="button"
                role="switch"
                aria-checked={isTicked(open)}
                className={styles.wkSwitch}
                onClick={() => toggleWeekend(open)}
              >
                <span>Plan it for this weekend</span>
                <span className={`switch ${isTicked(open) ? "on" : ""}`} />
              </button>
            )}
            <textarea
              className={styles.noteBox}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="A note for yourself, e.g. get the filter coffee"
              aria-label="Your note"
              maxLength={300}
            />
            <div className={styles.sheetActions}>
              <button
                type="button"
                className={styles.primary}
                onClick={saveNote}
              >
                Save note
              </button>
              {open.list === "want" && (
                <button type="button" onClick={been}>
                  I&apos;ve been
                </button>
              )}
              {open.event ? (
                <a
                  href={open.event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Tickets on {open.event.site}
                </a>
              ) : (
                <a
                  href={open.mapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Maps
                </a>
              )}
              <button
                type="button"
                className={styles.danger}
                onClick={remove}
                style={{
                  gridColumn: open.list === "been" ? "auto" : "1 / -1",
                }}
              >
                Remove
              </button>
            </div>
            <button
              type="button"
              className={styles.close}
              onClick={() => setOpen(null)}
            >
              Close
            </button>
          </div>
        </>
      )}
    </>
  );
}
