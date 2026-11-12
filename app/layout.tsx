import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import Feedback from "@/components/Feedback";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Feta",
  description: "Tonight's picks, chosen for your taste.",
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
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <body>
        {/* Applies a chosen Light/Dark appearance before the page paints. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("feta.theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
        <div className="app">
          <div className="haze haze-saffron" />
          <div className="haze haze-turquoise" />
          <div className="haze haze-rose" />
          <ToastProvider>{children}</ToastProvider>
          {/* Feedback reads the page address, so it waits inside Suspense. */}
          <Suspense>
            <Feedback />
          </Suspense>
        </div>
      </body>
    </html>
  );
}
