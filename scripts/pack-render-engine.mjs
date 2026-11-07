// SCHOLAR-VISUAL-001 phase 2: runs before `next build` (npm prebuild).
//
// The whole-slide engine (LibreOffice compiled to WebAssembly) is 247 MB unpacked, against a 250 MB limit on a whole function. Compressed it is
// about 78 MB, so that is what the render route carries (next.config.ts), and the function unpacks it into /tmp on an instance's first job.
// Nothing here is committed. If the package is missing the build still succeeds: the route answers that drawing is unavailable, and learners
// see the original pictures.
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

const wasm = join(process.cwd(), "node_modules", "@matbee", "libreoffice-converter", "wasm");
const out = join(process.cwd(), ".render-engine");
if (!existsSync(join(wasm, "soffice.wasm"))) {
  console.warn("[pack-render-engine] engine package not installed: whole-slide drawing will be unavailable in this build");
  process.exit(0);
}
mkdirSync(out, { recursive: true });
for (const f of ["soffice.wasm", "soffice.data"]) {
  await pipeline(createReadStream(join(wasm, f)), createGzip({ level: 6 }), createWriteStream(join(out, `${f}.gz`)));
  console.log(`[pack-render-engine] ${f}: ${statSync(join(wasm, f)).size} -> ${statSync(join(out, `${f}.gz`)).size} bytes`);
}
