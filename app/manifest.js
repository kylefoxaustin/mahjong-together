/* Web App Manifest (Next App Router metadata route → /manifest.webmanifest).
 * Makes "Mahjong, Together" installable as a real app on her Mac (Dock) and
 * her iPad (Home Screen): own window, no browser chrome. */
export default function manifest() {
  return {
    name: "Mahjong, Together",
    short_name: "Mahjong",
    description:
      "A gentle place to learn and play American Mahjong, with a patient coach beside you.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#022c22",
    theme_color: "#065f46",
    categories: ["games", "education"],
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
