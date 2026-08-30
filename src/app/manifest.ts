import type { MetadataRoute } from "next";

/**
 * PWA manifest.
 *
 * `display: "standalone"` is the only way to lose the browser's URL bar on iOS,
 * where the Fullscreen API is not available for arbitrary elements — once Leaf
 * is added to the home screen it opens chrome-free. On Android it does the same
 * and the Fullscreen API covers the in-browser case (see `useImmersive`).
 *
 * Colours are the night palette from `tokens.css` (night is the default theme),
 * so the splash and system chrome match the app instead of flashing white.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Leaf — a calm reader",
    short_name: "Leaf",
    description:
      "A calm web e-reader for public-domain classics and your own DRM-free EPUBs.",
    start_url: "/library",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#100d09",
    theme_color: "#100d09",
    categories: ["books", "education"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
