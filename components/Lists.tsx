"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TabBar from "@/components/TabBar";
import { useToast } from "@/components/Toast";
import {
  loadWhatsApp,
  markBeen,
  removeFromList,
  saveListNote,
  saveWhatsApp,
} from "@/lib/db";
import { fetchLists, type ListItem } from "@/lib/lists-client";
import { loadOrigin } from "@/lib/origin";
import styles from "./Lists.module.css";

type Tab = "want" | "been";

function savedLabel(item: ListItem) {
  if (item.event) return "Event";
  const days = Math.floor(
    (Date.now() - new Date(item.savedAt).getTime()) / 86400000,
  );
  const verb = item.list === "been" ? "Been" : "Saved";
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
  const [whatsApp, setWhatsApp] = useState<string | null>(null);
  const [number, setNumber] = useState("");

  // Lists refresh each time the screen is shown.
  useEffect(() => {
    let live = true;
    fetchLists(loadOrigin()).then((list) => live && setItems(list ?? []));
    loadWhatsApp().then((n) => live && setWhatsApp(n));
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

  const digits = number.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  const validNumber = /^[6-9]\d{9}$/.test(digits);

  return (
    <>
      <main className={styles.screen}>
        <h1 className={styles.title}>
          My <strong>lists</strong>
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
                onClick={() => router.push("/picks")}
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
                        <span className={styles.when}>{savedLabel(item)}</span>
                      </span>
                      <span
                        className={styles.area}
                        style={{ display: "block" }}
                      >
                        {[
                          item.area,
                          item.distanceKm !== null && `${item.distanceKm} km`,
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

        {items !== null && (
          <section className={styles.whatsapp}>
            <p className={styles.waTitle}>
              Want your weekend plan on WhatsApp?
            </p>
            {whatsApp ? (
              <>
                <p className={styles.waText}>
                  We&apos;ll send it to +91 {whatsApp.slice(0, 5)}{" "}
                  {whatsApp.slice(5)} on Fridays. Only used for this.
                </p>
                <button
                  type="button"
                  className={styles.waRemove}
                  onClick={() => {
                    saveWhatsApp(null);
                    setWhatsApp(null);
                    toast("Number removed");
                  }}
                >
                  Remove my number
                </button>
              </>
            ) : (
              <>
                <p className={styles.waText}>
                  A short plan for Saturday and Sunday, from your lists and
                  picks. Only used for this, and you can remove it any time.
                </p>
                <form
                  className={styles.waForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!validNumber) return;
                    saveWhatsApp(digits);
                    setWhatsApp(digits);
                    setNumber("");
                    toast("You're on the weekend plan list");
                  }}
                >
                  <label className={styles.waField}>
                    <span>+91</span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder="98765 43210"
                      aria-label="WhatsApp number"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    className={styles.waBtn}
                    disabled={!validNumber}
                  >
                    Send it
                  </button>
                </form>
              </>
            )}
          </section>
        )}
      </main>
      <TabBar active="lists" />
      {open && (
        <>
          <div className={styles.dim} onClick={() => setOpen(null)} />
          <div className={styles.sheet} role="dialog" aria-label={open.name}>
            <h2 className={styles.sheetTitle}>{open.name}</h2>
            <p className={styles.sheetSub}>
              {[
                open.area,
                open.distanceKm !== null && `${open.distanceKm} km`,
                open.event?.when,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
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
