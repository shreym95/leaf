import type { Metadata } from "next";
import {
  EB_Garamond,
  Fraunces,
  IBM_Plex_Mono,
  Atkinson_Hyperlegible,
  Source_Sans_3,
} from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { NavBar } from "@/components/ui/NavBar";

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

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
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
  ibmPlexMono.variable,
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
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <NavBar />
          <div className="flex flex-1 flex-col">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
