// Builds the Competen Scholar brand assets in public/brand/scholar/ from brand-src/competen-scholar-logo-source.jpg.
// Run: node scripts/brand/build-scholar-logo.mjs   (needs sharp, already a dependency of next)
//
// Transparency: the near-white background is removed by FLOOD FILL from the image edges only (connected
// background), never by a global threshold, so the white/grey globe interior stays opaque. Alpha is soft
// (distance to white, ramp 215..247 on the min channel) and the edge colour is un-blended from white so
// the cut-out does not carry a pale halo onto dark backgrounds.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(root, "brand-src", "competen-scholar-logo-source.jpg");
const OUT = join(root, "public", "brand", "scholar");
mkdirSync(OUT, { recursive: true });

// Measured on the source (1254x1254): emblem y 107..797, wordmark (Competen) from y 788, SCHOLAR to y 1074,
// tagline y 1112..1130. The book clasp (x 592-662) dips into the wordmark rows, so the two are separated by
// masking rectangles rather than a single horizontal cut.
const CLASP = { x0: 570, x1: 690 };
const EMBLEM_BOTTOM = 800;
const LOCKUP_BOTTOM = 1078;
const TAGLINE_BOTTOM = 1136;
const TOP = 90;

const { data: rgb, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const minc = (i) => Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);

// 1) connected background: min channel >= 225, reachable from the image border.
const bg = new Uint8Array(N);
const stack = [];
const push = (i) => { if (!bg[i] && minc(i) >= 225) { bg[i] = 1; stack.push(i); } };
for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
while (stack.length) {
  const i = stack.pop(), x = i % W, y = (i / W) | 0;
  if (x > 0) push(i - 1);
  if (x < W - 1) push(i + 1);
  if (y > 0) push(i - W);
  if (y < H - 1) push(i + W);
}
// 2) soft zone = background plus a 2px ring around it (anti-aliased edge pixels).
let zone = bg;
for (let pass = 0; pass < 2; pass++) {
  const next = Uint8Array.from(zone);
  for (let i = 0; i < N; i++) {
    if (zone[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if ((x > 0 && zone[i - 1]) || (x < W - 1 && zone[i + 1]) || (y > 0 && zone[i - W]) || (y < H - 1 && zone[i + W])) next[i] = 1;
  }
  zone = next;
}
// 3) alpha ramp + un-blend from white.
const rgba = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  let a = 1;
  if (zone[i]) a = Math.min(1, Math.max(0, (247 - minc(i)) / (247 - 215)));
  for (let c = 0; c < 3; c++) {
    let v = rgb[i * 3 + c];
    if (a > 0 && a < 1) v = Math.max(0, Math.min(255, Math.round((v - 255 * (1 - a)) / a)));
    rgba[i * 4 + c] = v;
  }
  rgba[i * 4 + 3] = Math.round(a * 255);
}

function variant({ y0, y1, clear = [] }) {
  const buf = Buffer.from(rgba);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let kill = y < y0 || y >= y1;
      for (const r of clear) if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) kill = true;
      if (kill) buf[(y * W + x) * 4 + 3] = 0;
    }
  }
  return buf;
}
function bbox(buf) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (buf[(y * W + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
const raw = (buf) => sharp(buf, { raw: { width: W, height: H, channels: 4 } });
async function save(pipeline, name) {
  const png = await pipeline.clone().png({ compressionLevel: 9 }).toBuffer();
  await sharp(png).toFile(join(OUT, `${name}.png`));
  await sharp(png).webp({ quality: 90, alphaQuality: 100 }).toFile(join(OUT, `${name}.webp`));
}
async function trimmed(buf, maxW, name) {
  const b = bbox(buf);
  const p = raw(buf).extract(b);
  const w = Math.min(maxW, b.width);
  await save(p.resize({ width: w, kernel: "lanczos3" }), name);
  console.log(name, b, "->", w);
}

// full lockup without tagline, with tagline, wordmark only
await trimmed(variant({ y0: TOP, y1: LOCKUP_BOTTOM }), 800, "competen-scholar-logo");
await trimmed(variant({ y0: TOP, y1: TAGLINE_BOTTOM }), 900, "competen-scholar-logo-tagline");
await trimmed(variant({ y0: 786, y1: LOCKUP_BOTTOM, clear: [{ x0: CLASP.x0, x1: CLASP.x1, y0: 0, y1: 805 }] }), 600, "competen-scholar-wordmark");

// emblem only: hide the top of the "C" that dips under the book (outside the clasp columns)
const emblemBuf = variant({ y0: TOP, y1: EMBLEM_BOTTOM, clear: [
  { x0: 0, x1: CLASP.x0, y0: 786, y1: H }, { x0: CLASP.x1, x1: W, y0: 786, y1: H } ] });
const eb = bbox(emblemBuf);
console.log("emblem", eb);
const side = Math.round(Math.max(eb.width, eb.height) * 1.08);
const emblemSquare = async (size, flatten) => {
  const inner = await raw(emblemBuf).extract(eb).toBuffer();
  const ext = sharp(inner, { raw: { width: eb.width, height: eb.height, channels: 4 } }).png();
  const innerPng = await ext.toBuffer();
  const padX = side - eb.width, padY = side - eb.height;
  const padded = await sharp(innerPng).extend({
    left: Math.floor(padX / 2), right: Math.ceil(padX / 2), top: Math.floor(padY / 2), bottom: Math.ceil(padY / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer();
  let p = sharp(padded).resize(size, size, { kernel: 'lanczos3' }); // extend must run first: sharp reorders resize before extend
  if (flatten) p = p.flatten({ background: "#ffffff" });
  return p;
};
// 512 stays transparent (in-page use). The small sizes are icons (browser tab, home screen, apple-touch): they are
// flattened onto white because the pale globe reads badly on a dark tab or an iOS black fill.
await save(await emblemSquare(512, false), "competen-scholar-emblem");
for (const size of [192, 180, 32]) await save(await emblemSquare(size, true), `competen-scholar-emblem-${size}`);
console.log("done");
