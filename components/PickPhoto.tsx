"use client";

import { useEffect, useRef, useState } from "react";
import { fetchPhoto, type Pick } from "@/lib/picks-client";

// A pick's photo. Picks arrive without the photo address; it is asked for
// only when the photo is about to come on screen, so places nobody scrolls
// to cost nothing.
export default function PickPhoto({ photo, className }: { photo: Pick["photo"]; className?: string }) {
  const [uri, setUri] = useState(photo?.uri || null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (uri || !photo?.ref || !ref.current) return;
    const ask = photo.ref;
    let live = true;
    const seen = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        seen.disconnect();
        fetchPhoto(ask).then((u) => live && u && setUri(u));
      },
      { rootMargin: "200px" },
    );
    seen.observe(ref.current);
    return () => {
      live = false;
      seen.disconnect();
    };
  }, [photo, uri]);

  if (!photo) return null;
  return uri ? (
    // Google's photo address is short-lived, so it is shown as is.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={uri} alt="" referrerPolicy="no-referrer" draggable={false} className={className} />
  ) : (
    <span ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0 }} />
  );
}
