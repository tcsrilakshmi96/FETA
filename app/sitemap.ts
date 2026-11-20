import type { MetadataRoute } from "next";

// The pages someone arriving from a search can open without an account.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://askfeta.com", changeFrequency: "weekly", priority: 1 },
    { url: "https://askfeta.com/privacy", changeFrequency: "monthly", priority: 0.3 },
  ];
}
