/* Generates the source art for @capacitor/assets (native app icon + splash).
 * Reuses the PWA tile-on-felt design. Run: node scripts/gen-native-assets.mjs
 * Outputs: assets/icon.png (1024), assets/splash.png + splash-dark.png (2732).
 * Then `npx @capacitor/assets generate` turns these into all native sizes.
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "assets");
mkdirSync(out, { recursive: true });

// The tile (ivory, 1-circle motif). `scale` sizes it within a square canvas.
const tile = (cx, cy, h) => {
  const w = h * 0.671; // portrait tile aspect (400/596)
  const x = cx - w / 2, y = cy - h / 2, r = h * 0.107;
  const rr = h * 0.272; // outer ring radius
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#tile)" stroke="#cbb88a" stroke-width="${h * 0.01}"/>
    <rect x="${x + h * 0.01}" y="${y + h * 0.01}" width="${w - h * 0.02}" height="${h * 0.25}" rx="${r * 0.9}" fill="#ffffff" opacity="0.45"/>
    <circle cx="${cx}" cy="${cy}" r="${rr}" fill="#065f46"/>
    <circle cx="${cx}" cy="${cy}" r="${rr * 0.78}" fill="#fafaf9"/>
    <circle cx="${cx}" cy="${cy}" r="${rr * 0.58}" fill="#d11f2a"/>
    <circle cx="${cx}" cy="${cy}" r="${rr * 0.33}" fill="#fafaf9"/>
    <circle cx="${cx}" cy="${cy}" r="${rr * 0.16}" fill="#065f46"/>`;
};

const defs = `
  <defs>
    <radialGradient id="felt" cx="50%" cy="38%" r="80%">
      <stop offset="0%" stop-color="#0b7a55"/><stop offset="100%" stop-color="#022c22"/>
    </radialGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#efe9d8"/>
    </linearGradient>
  </defs>`;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${defs}<rect width="1024" height="1024" fill="url(#felt)"/>${tile(512, 512, 596)}</svg>`;

// Splash: big square so the tile stays centered across device shapes.
const splash = (bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">
  ${defs}<rect width="2732" height="2732" fill="${bg}"/>${tile(1366, 1366, 980)}</svg>`;

await sharp(Buffer.from(icon)).resize(1024, 1024).png().toFile(join(out, "icon.png"));
await sharp(Buffer.from(splash("#065f46"))).resize(2732, 2732).png().toFile(join(out, "splash.png"));
await sharp(Buffer.from(splash("#022c22"))).resize(2732, 2732).png().toFile(join(out, "splash-dark.png"));
console.log("native assets written to", out);
