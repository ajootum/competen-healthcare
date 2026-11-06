import { fork } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { cp, copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { RENDER_WIDTH } from "./slide-render";

// ── DRAWING A DECK, ON OUR OWN FUNCTION ── SCHOLAR-VISUAL-001 phase 2 ───────────────────────────────────────────────────
//
// Server only. No AI, and the learner's file goes to no other service. LibreOffice compiled to WebAssembly turns the deck into a PDF, with every
// picture lossless at its own resolution, and pdf.js draws the chosen pages. The engine is about 250 MB unpacked, over a function's size limit,
// so scripts/pack-render-engine.mjs compresses it at build and it is unpacked into /tmp on the first job of an instance.
//
//   * It runs in a child process with an environment holding no secrets, and that process exits with the job.
//   * The job folder is removed whatever happens.
//   * One job at a time on an instance: the engine needs most of a function's 2 GB. A second request is told to come back.

const ENGINE_PACKAGE = "@matbee/libreoffice-converter";
/** Bumped with the package, so an instance never reuses another version's unpacked files. */
const ENGINE_VERSION = "2.7.2";
const ASSETS = () => join(process.cwd(), "src", "lib", "individual", "scholar", "render-assets");
/** Local development only: where the package is, when it is not in this checkout's node_modules. */
const packageDir = () => process.env.SCHOLAR_RENDER_PACKAGE_DIR || join(process.cwd(), "node_modules", ...ENGINE_PACKAGE.split("/"));

let unpacking: Promise<string> | null = null;

/** The folder holding the engine as it must be laid out (it finds soffice.wasm beside its own loader), unpacked once per instance. */
function engineRoot(): Promise<string> {
  const pkg = packageDir();
  // A development install keeps the engine unpacked: nothing to do.
  if (existsSync(join(pkg, "wasm", "soffice.wasm")) && existsSync(join(pkg, "wasm", "soffice.data"))) return Promise.resolve(pkg);
  return (unpacking ??= unpack(pkg).catch(e => { unpacking = null; throw e; }));
}

async function unpack(pkg: string): Promise<string> {
  const root = join(tmpdir(), `scholar-render-${ENGINE_VERSION}`);
  if (existsSync(join(root, "wasm", "soffice.wasm"))) return root;
  const packed = join(process.cwd(), ".render-engine");
  const part = await mkdtemp(join(tmpdir(), "scholar-render-unpack-"));
  try {
    await mkdir(join(part, "wasm"), { recursive: true });
    await cp(join(pkg, "dist"), join(part, "dist"), { recursive: true, filter: p => !p.endsWith(".map") });
    await copyFile(join(pkg, "package.json"), join(part, "package.json"));
    for (const f of ["loader.cjs", "soffice.cjs", "soffice.worker.cjs"]) await copyFile(join(pkg, "wasm", f), join(part, "wasm", f));
    for (const f of ["soffice.wasm", "soffice.data"]) await pipeline(createReadStream(join(packed, `${f}.gz`)), createGunzip(), createWriteStream(join(part, "wasm", f)));
    // The engine's own code imports zod from beside itself.
    await symlink(join(process.cwd(), "node_modules"), join(part, "node_modules"), "junction");
    await rename(part, root);
    return root;
  } catch (e) {
    await rm(part, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** Why a job did not produce a drawing. A short code, stored on the row: never any of the file's content. */
export class RenderError extends Error {
  constructor(public code: "engine_missing" | "engine_failed" | "timed_out") { super(code); }
}

/** Runs the engine in its own process, with no secrets in its environment, for at most `budgetMs`. */
function runWorker(root: string, job: string, budgetMs: number): Promise<void> {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", RENDER_ROOT: root, RENDER_JOB: job, RENDER_FONTS: join(ASSETS(), "fonts"), HOME: job, TMPDIR: job, PATH: process.env.PATH };
  if (process.platform === "win32") { env.SystemRoot = process.env.SystemRoot; env.TEMP = job; env.TMP = job; }
  return new Promise((resolve, reject) => {
    // Measured: skipping WebAssembly tier-up takes the engine's start from about 143 s to 96 s on one CPU, with the conversion no slower. Its own child inherits the flag.
    // Its own process group, because the engine runs in a child of the worker: killing the group frees all of its memory, not just the worker's.
    const child = fork(join(ASSETS(), "render-worker.mjs"), [], { env, cwd: job, execArgv: ["--no-wasm-tier-up"], stdio: "ignore", detached: process.platform !== "win32" });
    const killAll = () => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL");
      } catch { /* already gone */ }
    };
    const timer = setTimeout(() => { killAll(); reject(new RenderError("timed_out")); }, budgetMs);
    child.once("error", () => { clearTimeout(timer); killAll(); reject(new RenderError("engine_failed")); });
    child.once("exit", code => { clearTimeout(timer); killAll(); if (code === 0) resolve(); else reject(new RenderError("engine_failed")); });
  });
}

/** The deck as a PDF, with its fonts named for the engine. `aliased` is a working copy: the stored file is never written to. */
export async function deckToPdf(aliased: Uint8Array, budgetMs: number): Promise<Uint8Array> {
  let root: string;
  try { root = await engineRoot(); } catch { throw new RenderError("engine_missing"); }
  const job = await mkdtemp(join(tmpdir(), "scholar-render-job-"));
  try {
    await writeFile(join(job, "in.pptx"), aliased);
    await runWorker(root, job, budgetMs);
    return new Uint8Array(await readFile(join(job, "out.pdf")));
  } finally {
    await rm(job, { recursive: true, force: true }).catch(() => {});
  }
}

/** One page of a PDF as a lossless WebP, RENDER_WIDTH wide. */
export async function pageToWebp(pdf: Uint8Array, page: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { renderPageAsImage } = await import("unpdf");
  // pdf.js may keep the buffer it is given, so it gets its own copy.
  const png = await renderPageAsImage(pdf.slice(), page, { canvasImport: () => import("@napi-rs/canvas"), width: RENDER_WIDTH });
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(Buffer.from(png)).webp({ lossless: true, effort: 4 }).toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), width: info.width, height: info.height };
}

/** The page count of a PDF, or null when it cannot be opened. */
export async function pdfPageCount(pdf: Uint8Array): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    return (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
  } catch {
    return null;
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
