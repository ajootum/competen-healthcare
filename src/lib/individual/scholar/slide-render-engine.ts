import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RENDER_WIDTH } from "./slide-render";

// ── DRAWING A DECK, ON OUR OWN FUNCTION ── SCHOLAR-VISUAL-001 phase 2 ───────────────────────────────────────────────────
//
// Server only. No AI, and the learner's file goes to no other service. LibreOffice compiled to WebAssembly turns the deck into a PDF, with every
// picture lossless at its own resolution, and PDFium (Chrome's PDF engine, also WebAssembly) draws the chosen pages. No native module. LibreOffice is
// about 250 MB unpacked, over a function's size limit, so scripts/pack-render-engine.mjs compresses it at build and it is unpacked into /tmp on the
// first job of an instance.
//
//   * It runs in a child process with an environment holding no secrets, and that process exits with the job.
//   * The job folder is removed whatever happens.
//   * One job at a time on an instance: the engine needs most of a function's 2 GB. A second request is told to come back.

/** Why a job did not produce a drawing. A short code, stored on the row: never any of the file's content. */
export class RenderError extends Error {
  constructor(public code: "engine_missing" | "engine_failed" | "timed_out") { super(code); }
}

/**
 * Runs the engine in its own process, with no secrets in its environment, for at most `budgetMs`. A plain `node <file>` on purpose: the file is not part of the
 * app's bundle (a bundler resolves the argument of child_process.fork as a module, and fails the build), and every path to the engine lives inside it.
 */
function runWorker(job: string, budgetMs: number): Promise<void> {
  const app = process.cwd();
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", RENDER_APP: app, RENDER_JOB: job, RENDER_TMP: tmpdir(), HOME: job, TMPDIR: job, PATH: process.env.PATH };
  // Local development only: where the engine package is, when it is not in this checkout's node_modules.
  if (process.env.SCHOLAR_RENDER_PACKAGE_DIR) env.RENDER_PACKAGE = process.env.SCHOLAR_RENDER_PACKAGE_DIR;
  if (process.platform === "win32") { env.SystemRoot = process.env.SystemRoot; env.TEMP = job; env.TMP = job; }
  return new Promise((resolve, reject) => {
    // Measured: skipping WebAssembly tier-up takes the engine's start from about 143 s to 96 s on one CPU, with the conversion no slower. Its own child inherits the flag.
    // Its own process group, because the engine runs in a child of the worker: killing the group frees all of its memory, not just the worker's.
    const child = spawn(process.execPath, ["--no-wasm-tier-up", join(app, "src", "lib", "individual", "scholar", "render-assets", "render-worker.mjs")], { env, cwd: job, stdio: "ignore", detached: process.platform !== "win32" });
    const killAll = () => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL");
      } catch { /* already gone */ }
    };
    const timer = setTimeout(() => { killAll(); reject(new RenderError("timed_out")); }, budgetMs);
    child.once("error", () => { clearTimeout(timer); killAll(); reject(new RenderError("engine_failed")); });
    child.once("exit", code => {
      clearTimeout(timer);
      killAll();
      if (code === 0) resolve();
      else reject(new RenderError(code === 3 ? "engine_missing" : "engine_failed"));
    });
  });
}

/** The deck as a PDF, with its fonts named for the engine. `aliased` is a working copy: the stored file is never written to. */
export async function deckToPdf(aliased: Uint8Array, budgetMs: number): Promise<Uint8Array> {
  const job = await mkdtemp(join(tmpdir(), "scholar-render-job-"));
  try {
    await writeFile(join(job, "in.pptx"), aliased);
    await runWorker(job, budgetMs);
    return new Uint8Array(await readFile(join(job, "out.pdf")));
  } finally {
    await rm(job, { recursive: true, force: true }).catch(() => {});
  }
}

export type DrawnPage = { bytes: Uint8Array; width: number; height: number; blank: boolean };
export type PdfDrawing = { pageCount: number; draw: (page: number) => Promise<DrawnPage>; close: () => void };

/**
 * A PDF opened for drawing: each page as a lossless WebP, RENDER_WIDTH wide, on white. `blank`: it drew as one flat colour, so whatever is on it could
 * not be drawn. Close it when done. Throws when the PDF cannot be opened.
 */
export async function openPdfDrawing(pdf: Uint8Array): Promise<PdfDrawing> {
  const { PDFiumLibrary } = await import("@hyzyla/pdfium");
  const sharp = (await import("sharp")).default;
  const library = await PDFiumLibrary.init();
  try {
    const doc = await library.loadDocument(pdf);
    return {
      pageCount: doc.getPageCount(),
      draw: async page => {
        const it = doc.getPage(page - 1);
        const shown = await it.render({ scale: RENDER_WIDTH / it.getOriginalSize().originalWidth, render: "bitmap" });
        const flat = sharp(Buffer.from(shown.data), { raw: { width: shown.width, height: shown.height, channels: 4 } }).flatten({ background: "#ffffff" });
        const { channels } = await flat.clone().stats();
        const { data, info } = await flat.webp({ lossless: true, effort: 4 }).toBuffer({ resolveWithObject: true });
        return { bytes: new Uint8Array(data), width: info.width, height: info.height, blank: channels.every(c => c.min === c.max) };
      },
      close: () => { doc.destroy(); library.destroy(); },
    };
  } catch (e) {
    library.destroy();
    throw e;
  }
}

// One job at a time on an instance. Reserved before the claim is taken, so two requests arriving together cannot both start.
let busy = false;
/** True if the engine is now reserved for the caller, who must call releaseEngine() when finished, or if it never starts. */
export function reserveEngine(): boolean {
  if (busy) return false;
  busy = true;
  return true;
}
export function releaseEngine(): void { busy = false; }
