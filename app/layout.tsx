import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Fraunces, Outfit } from "next/font/google";
import Feedback from "@/components/Feedback";
import FreshVersion from "@/components/FreshVersion";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

// The magazine headline and tile titles on Home.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["300", "500"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://askfeta.com"),
  title: "Feta",
  description: "Tonight's picks, chosen for your taste.",
  // The preview a shared link shows on WhatsApp and elsewhere.
  openGraph: { title: "Feta", description: "Where to eat, what to do and what to wear tonight, chosen for your taste.", url: "https://askfeta.com", siteName: "Feta", images: [{ url: "/og.jpg", width: 1200, height: 630 }] },
  // Added to an iPhone's home screen, Feta opens full-screen as an app.
  appleWebApp: { capable: true, title: "Feta", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Shrink the page when the keyboard opens, so the main button stays visible.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF3EE" },
    { media: "(prefers-color-scheme: dark)", color: "#161213" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${outfit.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <body>
        {/* Applies a chosen Light/Dark appearance before the page paints. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("feta.theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
        <div className="app">
          <ToastProvider>{children}</ToastProvider>
          {/* Feedback reads the page address, so it waits inside Suspense. */}
          <Suspense>
            <Feedback />
            <FreshVersion />
          </Suspense>
        </div>
      </body>
    </html>
  );
}
