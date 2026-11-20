import type { MetadataRoute } from "next";

// Search engines may read the public pages, never the app's data or admin.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin"] },
    sitemap: "https://askfeta.com/sitemap.xml",
  };
}
