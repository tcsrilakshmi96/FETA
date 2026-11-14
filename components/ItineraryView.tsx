"use client";

import PickPhoto from "@/components/PickPhoto";
import type { Pick } from "@/lib/picks-client";
import type { Itinerary } from "@/lib/server/itinerary";
import styles from "./Ask.module.css";

// A plan stop by stop (a day from chat, or a city's days on a trip).
export default function ItineraryView({ itinerary, onStop }: { itinerary: Itinerary; onStop: (pick: Pick) => void }) {
  return (
    <div className={styles.itinerary}>
      <p className={styles.itTitle}>{itinerary.title}</p>
      {itinerary.days.map((d) => (
        <div key={d.date} className={styles.itDay}>
          {itinerary.days.length > 1 && <p className={styles.itDayLabel}>{d.label}</p>}
          <ol className={styles.itStops}>
            {d.stops.map((st) => (
              <li key={st.pick.placeId}>
                {st.travel && <span className={styles.itTravel}>{st.travel}</span>}
                <button type="button" className={styles.itStop} onClick={() => onStop(st.pick)}>
                  <span className={styles.itTime}>{st.time}</span>
                  <span className={styles.itPic}>
                    <PickPhoto photo={st.pick.photo} />
                  </span>
                  <span className={styles.itText}>
                    <span className={styles.itSlot}>{st.slot}</span>
                    <span className={styles.itName}>{st.pick.name}</span>
                    <span className={styles.itArea}>{st.pick.area}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ))}
      <p className={styles.attribution}>
        Places and photos: <span translate="no">Google Maps</span>. Tap a stop for hours and directions.
      </p>
    </div>
  );
}
