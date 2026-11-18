import type { MetadataRoute } from "next";

// Installable Feta (founder, 18 Nov 2026): "Add to Home Screen" gives the
// cheese icon and a full-screen app without the browser bar. Updates are
// instant, as on the website.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Feta",
    short_name: "Feta",
    description: "Where to eat, what to do, picked for your taste.",
    start_url: "/",
    display: "standalone",
    background_color: "#161213",
    theme_color: "#161213",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
