// SCHOLAR-VISUAL-001 phase 2. One job, one process, then it exits.
//
// Forked by slide-render-engine.ts with an environment holding NO secrets: only the paths below. LibreOffice itself runs compiled to
// WebAssembly, so a damaged or hostile file has only the engine's own linear memory to reach. Reads in.pptx from the job folder and writes
// out.pdf beside it. Nothing here opens a network connection.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { RENDER_ROOT, RENDER_JOB, RENDER_FONTS } = process.env;
if (!RENDER_ROOT || !RENDER_JOB || !RENDER_FONTS) process.exit(2);

// Every pixel of a picture is kept, at its own resolution, and hidden slides stay in, so a page number is a place in the deck.
const FILTER = JSON.stringify({
  UseLosslessCompression: { type: "boolean", value: "true" },
  ReduceImageResolution: { type: "boolean", value: "false" },
  ExportHiddenSlides: { type: "boolean", value: "true" },
  ExportNotesPages: { type: "boolean", value: "false" },
  ExportBookmarks: { type: "boolean", value: "false" },
});

const { createSubprocessConverter, loadFontsFromDirectory } = await import(pathToFileURL(join(RENDER_ROOT, "dist", "index.js")).href);
const fonts = await loadFontsFromDirectory(RENDER_FONTS);
const converter = await createSubprocessConverter({ fonts, wasmPath: join(RENDER_ROOT, "wasm") });
const out = await converter.convert(readFileSync(join(RENDER_JOB, "in.pptx")), { outputFormat: "pdf", inputFormat: "pptx", filterOptions: FILTER }, "in.pptx");
writeFileSync(join(RENDER_JOB, "out.pdf"), out.data);
await converter.destroy?.();
process.exit(0);
