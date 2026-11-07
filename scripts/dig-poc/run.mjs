// COMPETEN-DIG-001 proof of concept. Bundles bench.ts and starts each scenario in its own container: offline, 2 GB, no swap, 2 CPUs (what Vercel's box reports).
// One at a time. usage: node scripts/dig-poc/run.mjs <work folder> <label> <engine> <deck file in in/> [scenario args...]
//   engine: node <scenario> | markitdown | docling-slim | docling-full
// env: DIG_MEMORY (default 2g), DIG_CPUS (default 2), DIG_ENGINE_SRC=reliability to use the paused SCHOLAR-VISUAL-001 controls, unchanged, from b49ab177.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const [work, label, engine, ...args] = process.argv.slice(2);
const root = resolve(work);
const out = join(root, "out");
mkdirSync(out, { recursive: true });
const MEMORY = process.env.DIG_MEMORY ?? "2g", CPUS = process.env.DIG_CPUS ?? "2";
const docker = (image, inner, extra = []) => {
  const r = spawnSync("docker", ["run", "--rm", `--name=dig-${label}`, `--cpus=${CPUS}`, `--memory=${MEMORY}`, `--memory-swap=${MEMORY}`, "--network=none",
    "-v", `${join(root, "in")}:/in:ro`, "-v", `${out}:/out`, "-v", `${join(here, "engines")}:/engines:ro`, ...extra, image, "sh", "/engines/measure.sh", label, "/out", ...inner],
    { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 1 << 24, timeout: 900_000 });
  const line = (r.stdout ?? "").trim().split("\n").pop();
  console.log(line);
  if (r.status !== 0 || r.stderr?.trim()) console.error((r.stderr ?? "").split("\n").slice(-8).join("\n"));
};

if (engine === "node") {
  const [scenario, deck, ...rest] = args;
  const bundle = join(root, "bench.bundle.mjs");
  const reliability = process.env.DIG_ENGINE_SRC === "reliability";
  const relDir = join(root, "reliability", "src", "lib", "individual", "scholar");
  await build({
    entryPoints: [join(here, "bench.ts")], bundle: true, platform: "node", format: "esm", outfile: bundle, target: "node22", logLevel: "error",
    alias: { "@": join(repo, "src") }, tsconfig: join(repo, "tsconfig.json"),
    external: ["sharp", "jszip", "unpdf", "mammoth", "@hyzyla/pdfium", "pdf-lib", "@pdf-lib/fontkit"],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url); const __dirname = '/poc'; const __filename = '/poc/bench.bundle.mjs';" },
    plugins: reliability ? [{ name: "reliability", setup(b) {
      b.onResolve({ filter: /scholar\/slide-render(-engine|-mem)?$/ }, a => {
        if (existsSync(join(relDir, a.path.split("/").pop() + ".ts"))) return { path: join(relDir, a.path.split("/").pop() + ".ts") };
      });
      b.onResolve({ filter: /^\.\/slide-render(-mem)?$/ }, a => a.resolveDir.startsWith(relDir) ? { path: join(relDir, a.path.slice(2) + ".ts") } : undefined);
    } }] : [],
  });
  docker("dig-poc-node", ["node", "/poc/bench.bundle.mjs", scenario, `/in/${deck}`, "/out", ...rest], [
    "-v", `${bundle}:/poc/bench.bundle.mjs:ro`, "-v", `${join(repo, "src")}:/poc/src:ro`,
    "-e", `DIG_LABEL=${label}`, "-e", "SCHOLAR_RENDER_PACKAGE_DIR=/poc/node_modules/@matbee/libreoffice-converter", "-w", "/poc",
  ]);
} else if (engine === "markitdown") {
  docker("dig-poc-markitdown", ["python", "/engines/markitdown_run.py", `/in/${args[0]}`, "/out"]);
} else if (engine === "docling-slim" || engine === "docling-full") {
  docker(`dig-poc-${engine}`, ["python", "/engines/docling_run.py", `/in/${args[0]}`, "/out", label]);
} else { console.error("unknown engine"); process.exit(2); }
if (existsSync(join(out, `${label}.json`))) {
  try {
    const j = JSON.parse(readFileSync(join(out, `${label}.json`), "utf8"));
    console.log(JSON.stringify({ ok: j.ok, error: j.error, stages: j.stages }));
  } catch { /* a run killed while writing */ }
}
