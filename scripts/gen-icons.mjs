/* Generates the PWA app icons from one SVG master.
 * Ivory mahjong tile with the classic "1-circle" motif on emerald felt —
 * matches the app's emerald/amber/ivory theme. Re-run with: node scripts/gen-icons.mjs
 * Output: public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

// 1024 master, drawn fully within the 80% maskable safe zone so the same art
// works as a normal icon, a maskable icon, and an Apple touch icon.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="felt" cx="50%" cy="36%" r="78%">
      <stop offset="0%" stop-color="#0b7a55"/>
      <stop offset="100%" stop-color="#022c22"/>
    </radialGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#efe9d8"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#felt)"/>
  <!-- ivory tile (portrait), centered, inside the safe zone -->
  <rect x="312" y="214" width="400" height="596" rx="64" fill="url(#tile)" stroke="#cbb88a" stroke-width="6"/>
  <rect x="318" y="220" width="388" height="150" rx="58" fill="#ffffff" opacity="0.45"/>
  <!-- classic 1-circle motif (green / white / red concentric rings) -->
  <circle cx="512" cy="512" r="162" fill="#065f46"/>
  <circle cx="512" cy="512" r="126" fill="#fafaf9"/>
  <circle cx="512" cy="512" r="94"  fill="#d11f2a"/>
  <circle cx="512" cy="512" r="54"  fill="#fafaf9"/>
  <circle cx="512" cy="512" r="26"  fill="#065f46"/>
</svg>`;

const master = sharp(Buffer.from(svg));
const png = (size) => master.clone().resize(size, size).png();

await png(192).toFile(join(out, "icon-192.png"));
await png(512).toFile(join(out, "icon-512.png"));
await png(512).toFile(join(out, "icon-maskable-512.png"));
await png(180).toFile(join(out, "apple-touch-icon.png"));
console.log("icons written to", out);
