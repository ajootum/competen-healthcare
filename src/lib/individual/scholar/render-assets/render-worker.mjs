// SCHOLAR-VISUAL-001 phase 2. One job, one process, then it exits.
//
// A plain file run by node, and never bundled: slide-render-engine.ts starts it as a child process, with an environment holding NO secrets, only the
// paths below. LibreOffice itself runs compiled to WebAssembly, so a damaged or hostile file has only the engine's own linear memory to reach. Reads
// in.pptx from the job folder and writes out.pdf beside it. Nothing here opens a network connection.
//
// All knowledge of where the engine lives is here, so the app's bundler never sees those paths (next.config.ts names what must ship with the route).
// The engine is about 250 MB unpacked, over a function's size limit, so scripts/pack-render-engine.mjs compresses it at build and the first job of an
// instance unpacks it into /tmp. It finds soffice.wasm beside its own loader, hence the layout. A development install keeps it unpacked and is used as it is.
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

const { RENDER_APP, RENDER_JOB, RENDER_PACKAGE, RENDER_TMP } = process.env;
if (!RENDER_APP || !RENDER_JOB || !RENDER_TMP) process.exit(2);

/** Bumped with the package, so an instance never reuses another version's unpacked files. */
const ENGINE_VERSION = "2.7.2";
const pkg = RENDER_PACKAGE || join(RENDER_APP, "node_modules", "@matbee", "libreoffice-converter");

async function engineRoot() {
  if (existsSync(join(pkg, "wasm", "soffice.wasm")) && existsSync(join(pkg, "wasm", "soffice.data"))) return pkg;
  const root = join(RENDER_TMP, `scholar-render-${ENGINE_VERSION}`);
  if (existsSync(join(root, "wasm", "soffice.wasm"))) return root;
  const part = await mkdtemp(join(RENDER_TMP, "scholar-render-unpack-"));
  try {
    await mkdir(join(part, "wasm"), { recursive: true });
    await cp(join(pkg, "dist"), join(part, "dist"), { recursive: true, filter: p => !p.endsWith(".map") });
    await copyFile(join(pkg, "package.json"), join(part, "package.json"));
    for (const f of ["loader.cjs", "soffice.cjs", "soffice.worker.cjs"]) await copyFile(join(pkg, "wasm", f), join(part, "wasm", f));
    for (const f of ["soffice.wasm", "soffice.data"]) await pipeline(createReadStream(join(RENDER_APP, ".render-engine", `${f}.gz`)), createGunzip(), createWriteStream(join(part, "wasm", f)));
    // The engine's own code imports zod from beside itself.
    await symlink(join(RENDER_APP, "node_modules"), join(part, "node_modules"), "junction");
    await rename(part, root);
    return root;
  } catch (e) {
    await rm(part, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

// Every pixel of a picture is kept, at its own resolution, and hidden slides stay in, so a page number is a place in the deck.
const FILTER = JSON.stringify({
  UseLosslessCompression: { type: "boolean", value: "true" },
  ReduceImageResolution: { type: "boolean", value: "false" },
  ExportHiddenSlides: { type: "boolean", value: "true" },
  ExportNotesPages: { type: "boolean", value: "false" },
  ExportBookmarks: { type: "boolean", value: "false" },
});

let root;
try {
  root = await engineRoot();
} catch {
  process.exit(3); // the engine is not there: the job records why
}
const { createSubprocessConverter, loadFontsFromDirectory } = await import(pathToFileURL(join(root, "dist", "index.js")).href);
const fonts = await loadFontsFromDirectory(join(dirname(fileURLToPath(import.meta.url)), "fonts"));
const converter = await createSubprocessConverter({ fonts, wasmPath: join(root, "wasm") });
const out = await converter.convert(await readFile(join(RENDER_JOB, "in.pptx")), { outputFormat: "pdf", inputFormat: "pptx", filterOptions: FILTER }, "in.pptx");
await writeFile(join(RENDER_JOB, "out.pdf"), out.data);
await converter.destroy?.();
process.exit(0);
