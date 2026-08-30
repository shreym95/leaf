import type { Metadata } from "next";
import {
  EB_Garamond,
  Fraunces,
  JetBrains_Mono,
  Atkinson_Hyperlegible,
  Source_Sans_3,
} from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

/* Fonts — the `variable` names are a contract with src/design/tokens.css. */

const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "700"],
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600"],
});

const fontVariables = [
  ebGaramond.variable,
  fraunces.variable,
  jetbrainsMono.variable,
  atkinson.variable,
  sourceSans.variable,
].join(" ");

export const metadata: Metadata = {
  title: "Leaf",
  description:
    "A calm web e-reader for public-domain classics and your own DRM-free EPUBs.",
};

/* Pre-paint: adopt the saved theme before first paint so there is no flash.
   Dependency-free, tiny, runs synchronously in <head>. */
const themeScript = `!function(){try{var t=localStorage.getItem("leaf-theme")||"night";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="night"}}()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fontVariables} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly etc.) inject
          attributes onto <body> before React hydrates. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* Chrome lives in the route-group layouts, not here: the reader
            (src/app/(reader)) renders full-bleed with its own immersive bars
            and no app NavBar (SPEC §8). */}
        <ThemeProvider>{children}</ThemeProvider>
        {/* Zero-config telemetry (SPEC §9 M4). Screen views / import events are
            sent explicitly via src/lib/analytics.ts — never reading content. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
