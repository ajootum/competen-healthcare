/**
 * PD SCREEN DOCTRINE HARNESS — the countable rule out of docs/CPR-PD-SCREEN-DOCTRINE.md §2.
 *
 * PD-001 §3 and PD-002 §4: no raw implementation detail on a Product Director surface. Migration
 * numbers, file paths and file:line references belong in Technical Operations.
 *
 * ⚠ THIS IS NOT A BAN, IT IS A PLACEMENT RULE, AND THE DIFFERENCE IS THE WHOLE POINT. A verdict like
 * "no market override can ever be written" is worth nothing if the reader cannot check it, so the
 * citations must SURVIVE — inside a <Cite> or <Explain> disclosure, or a `citation` field, or a source
 * comment. Product Configuration ended its rework with MORE identifiers than it started with (59 -> 62)
 * and satisfied §3 completely. What this harness forbids is an identifier in a sentence the reader
 * cannot avoid.
 *
 * ⚠ AND IT EXISTS BECAUSE READING DOES NOT CATCH THIS. Every one of those 59 sentences was individually
 * defensible; a screenshot review passed them twice. The breach was only ever visible in aggregate,
 * which makes it a counting job and therefore a harness's job. Third instance of the class.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";

// ⚠ readdirSync RATHER THAN globSync, WHICH THIS REPO'S TYPES DO NOT CARRY. Node 24 runs globSync
// happily and the harness passed on it — `tsc` was the only thing that objected, which is exactly the
// order in which that mistake is cheapest to find. Every other harness here walks directories the same
// way, so this now matches them.
function walk(dir: string, ext: RegExp, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = `${dir}/${e}`;
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(e)) out.push(p);
  }
  return out;
}

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── what counts as an implementation identifier ─────────────────────────────
// migration:line (278:123), file:line (runtime.ts:19), "migration 099", a src/ path.
const ID = /\b\d{2,3}:\d{1,3}(?:-\d{1,3})?\b|\b[\w-]+\.tsx?:\d+|\bmigrations?\s+\d{2,3}\b|\bsrc\/(?:lib|app|components)\/[\w/.-]+/gi;

// ⚠ LINE-PRESERVING COMMENT BLANKING, NOT STRIPPING. Deleting comment lines shifts every line number
// after them, so a reported offender points at the wrong line — and a previous harness in this repo
// reddened itself when its own explanatory comments quoted the thing they described.
function blankComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
  return noBlock.split("\n").map(l => l.replace(/\/\/.*$/, m => " ".repeat(m.length))).join("\n");
}

/**
 * Walk a JSX file tracking how deep we are inside a disclosure. <Explain> and <Cite> both render a
 * real <details>, so anything between their tags is content the reader chose to open.
 */
function disclosureMask(src: string): boolean[] {
  const lines = src.split("\n");
  const mask: boolean[] = [];
  let depth = 0;
  for (const line of lines) {
    const opensHere = (line.match(/<(?:Explain|Cite)\b/g) ?? []).length;
    const closesHere = (line.match(/<\/(?:Explain|Cite)>/g) ?? []).length;
    // a line that OPENS a disclosure counts as inside it: <Explain summary="...">TEXT is one line.
    mask.push(depth > 0 || opensHere > 0);
    depth += opensHere - closesHere;
    if (depth < 0) depth = 0;
  }
  return mask;
}

/**
 * In a loader, a citation carrier is one of the declared CARRIER_FIELDS, including its multi-line
 * string continuations.
 *
 * ⚠ THE FIELD NAME ALONE IS EVIDENCE OF NOTHING. Calling a property `migration` does not put it behind
 * a disclosure — Product Configuration's stores table carries one and does render it inside <Explain>,
 * but nothing in the loader says so, and a later edit could move it into the visible row without
 * touching the loader at all. Pin 4 checks every render site of every carrier field, so this mask is
 * trusted only for as long as that pin holds.
 */
const CARRIER_FIELDS = ["citation", "cite", "evidence", "migration"];

/**
 * Blank the VALUE of any carrier field written inline, so the line can still be scanned for what is
 * left of it.
 *
 * ⚠ A LINE MASK ALONE IS THE WRONG SHAPE FOR HALF OF THESE. Product Configuration's store table writes
 * `{ table: "practice_plans", migration: "191:249", holds: "..." }` on ONE line: a whole-line mask
 * either forgives the entire row — including whatever the `holds` sentence says — or forgives none of
 * it. Blanking the value first forgives exactly the citation and keeps the rest under scrutiny.
 */
function blankCarrierValues(line: string): string {
  return line.replace(
    new RegExp(`\\b(?:${CARRIER_FIELDS.join("|")})\\s*:\\s*(["'])(?:\\\\.|(?!\\1).)*\\1`, "g"),
    m => " ".repeat(m.length),
  );
}

function citationMask(src: string): boolean[] {
  const lines = src.split("\n");
  const mask: boolean[] = [];
  let inCitation = false;
  const opensCarrier = new RegExp(`^\\s*(?:${CARRIER_FIELDS.join("|")})\\s*:`);
  for (const line of lines) {
    if (opensCarrier.test(line)) inCitation = true;
    else if (inCitation && !/^\s*\+?\s*["'`]/.test(line)) inCitation = false;
    mask.push(inCitation);
  }
  return mask;
}

/**
 * ⚠ THE ONE THING PER-FILE ANALYSIS CANNOT SEE. A loader may export a long absence sentence that the
 * PAGE renders inside <Explain> — LIFECYCLE_ABSENCE does exactly this. Reading pd-releases.ts alone,
 * that string looks like a visible sentence full of migration numbers; it is not.
 *
 * Rather than assume, each such constant is declared here and the harness VERIFIES the claim: every
 * render site of the name must sit inside a disclosure. An assumption becomes a checked fact, and a
 * constant quietly moved out of its <Explain> turns this red.
 */
const DISCLOSURE_ONLY = ["LIFECYCLE_ABSENCE"];

/**
 * True for every line belonging to an import statement, single- or multi-line.
 *
 * ⚠ A FIRST ATTEMPT MATCHED ONLY `^import` PLUS AN ALL-CAPS CONTINUATION SHAPE, and a mixed-case
 * continuation line — `SUBMODULES, ROLLOUT_STAGES, LIFECYCLE_ABSENCE, refusalFor,` — was read as a
 * render site outside a disclosure. Naming a symbol is not rendering it.
 */
function importMask(src: string): boolean[] {
  const lines = src.split("\n");
  const mask: boolean[] = [];
  let open = false;
  for (const line of lines) {
    if (/^\s*import\b/.test(line)) {
      mask.push(true);
      open = !/;\s*$/.test(line);
    } else {
      mask.push(open);
      if (open && /;\s*$/.test(line)) open = false;
    }
  }
  return mask;
}

/**
 * ⚠ FLAT BAN WHERE THE DOCTRINE HAS BEEN APPLIED, RATCHET EVERYWHERE ELSE — the shape
 * practice-responsive-harness already uses for the wall-clock rule, and for the same reason.
 *
 * Configuration, Releases and Health have been built or reworked against docs/CPR-PD-SCREEN-DOCTRINE.md
 * and each carries a real <Explain>/<Cite> pair, so zero is the only acceptable number there. Practices,
 * Practitioners and Operations were built earlier, and their component files have NO disclosure
 * component at all — which is precisely why their citations ended up in visible prose. Fixing them
 * means giving those modules a disclosure, which is a refactor and not this harness's business.
 *
 * ⚠ SO THE DEBT IS COUNTED, NOT FORGIVEN. The baseline below is the measured number today. It may fall
 * and it may never rise: a new visible identifier in a legacy module turns this red just as it would in
 * a doctrine module. What the ratchet buys is that the harness ships GREEN and honest instead of
 * shipping red and being ignored, and the number in this file is the debt, in writing.
 */
const DOCTRINE_MODULES = ["configuration", "releases", "health"];
const LEGACY_VISIBLE_BASELINE = 16;

function moduleOf(file: string): string {
  const norm = file.replace(/\\/g, "/");
  const page = /src\/app\/super-admin\/pd\/([^/]+)\//.exec(norm);
  if (page) return page[1];
  const loader = /src\/lib\/hq\/pd-([\w-]+)\.ts/.exec(norm);
  return loader ? loader[1] : "unknown";
}
const isDoctrine = (f: string) => DOCTRINE_MODULES.includes(moduleOf(f));

const PAGES = walk("src/app/super-admin/pd", /\.tsx$/);
const LOADERS = walk("src/lib/hq", /^pd-.*\.ts$/).filter((f: string) => !f.includes("metric-registry"));

console.log("\nPD SCREEN DOCTRINE — implementation identifiers by placement\n");
console.log(`  surfaces: ${PAGES.length} pages/components, ${LOADERS.length} loaders\n`);

// ── PIN 1: no identifier in visible page text ───────────────────────────────
let citedInPages = 0;
const pageOffenders: string[] = [];
const legacyOffenders: string[] = [];
for (const f of PAGES) {
  const src = blankComments(readFileSync(f, "utf8"));
  const mask = disclosureMask(src);
  src.split("\n").forEach((line, i) => {
    const hits = line.match(ID);
    if (!hits) return;
    if (mask[i]) citedInPages += hits.length;
    else (isDoctrine(f) ? pageOffenders : legacyOffenders).push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}
check("1. doctrine modules — no implementation identifier in visible page text",
  pageOffenders.length === 0,
  pageOffenders.length ? `${pageOffenders.length} visible:\n      ${pageOffenders.slice(0, 8).join("\n      ")}` : undefined);

// ── PIN 2: no identifier in visible loader text ─────────────────────────────
let citedInLoaders = 0;
const loaderOffenders: string[] = [];
for (const f of LOADERS) {
  const raw = readFileSync(f, "utf8");
  const src = blankComments(raw);
  const cmask = citationMask(src);
  // blank out the bodies of declared disclosure-only constants
  const lines = src.split("\n");
  let inDisclosureConst = false;
  lines.forEach((line, i) => {
    if (DISCLOSURE_ONLY.some(n => new RegExp(`\\b(?:const|let)\\s+${n}\\b`).test(line))) inDisclosureConst = true;
    else if (inDisclosureConst && /;\s*$/.test(lines[i - 1] ?? "")) inDisclosureConst = false;
    const scanned = blankCarrierValues(line);
    const inlineCited = (line.match(ID) ?? []).length - (scanned.match(ID) ?? []).length;
    citedInLoaders += inlineCited;
    const hits = scanned.match(ID);
    if (!hits) return;
    if (cmask[i] || inDisclosureConst) citedInLoaders += hits.length;
    else (isDoctrine(f) ? loaderOffenders : legacyOffenders).push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}
check("2. doctrine modules — no implementation identifier in visible loader text",
  loaderOffenders.length === 0,
  loaderOffenders.length ? `${loaderOffenders.length} visible:\n      ${loaderOffenders.slice(0, 8).join("\n      ")}` : undefined);

// ── PIN 3: every disclosure-only constant is actually rendered in a disclosure ──
const unwrapped: string[] = [];
for (const name of DISCLOSURE_ONLY) {
  let renderSites = 0;
  for (const f of PAGES) {
    const src = blankComments(readFileSync(f, "utf8"));
    const mask = disclosureMask(src);
    const imports = importMask(src);
    src.split("\n").forEach((line, i) => {
      if (imports[i]) return;
      if (!new RegExp(`\\{\\s*${name}\\s*\\}|\\b${name}\\b`).test(line)) return;
      renderSites++;
      if (!mask[i]) unwrapped.push(`${name} rendered outside a disclosure at ${f}:${i + 1}`);
    });
  }
  if (renderSites === 0) unwrapped.push(`${name} is declared disclosure-only but is never rendered — stale entry`);
}
check("3. every disclosure-only constant renders inside a disclosure",
  unwrapped.length === 0, unwrapped.slice(0, 6).join("; "));

// ── PIN 3b: the legacy ratchet — the debt may fall, never rise ──────────────
check(`3b. legacy modules — visible identifiers <= ${LEGACY_VISIBLE_BASELINE} (ratchet)`,
  legacyOffenders.length <= LEGACY_VISIBLE_BASELINE,
  `${legacyOffenders.length} found:\n      ${legacyOffenders.slice(0, 10).join("\n      ")}`);
if (legacyOffenders.length < LEGACY_VISIBLE_BASELINE) {
  console.log(`       ↓ debt fell to ${legacyOffenders.length} — lower LEGACY_VISIBLE_BASELINE to pin it`);
}

// ── PIN 4: every carrier field is RENDERED inside a disclosure ──────────────
// ⚠ THIS IS THE PIN THAT EARNS PIN 2. Pin 2 forgives an identifier because it sits in a field called
// `citation` or `migration`; that forgiveness is only sound if those fields reach the reader behind a
// <details>. Without this pin, renaming a visible property to `citation` would launder a breach.
const leaked: string[] = [];
for (const f of PAGES) {
  const src = blankComments(readFileSync(f, "utf8"));
  const mask = disclosureMask(src);
  const imports = importMask(src);
  const renders = new RegExp(`\\{[^{}]*\\.(?:${CARRIER_FIELDS.join("|")})\\b`);
  src.split("\n").forEach((line, i) => {
    if (imports[i] || !renders.test(line)) return;
    if (!mask[i]) leaked.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
  });
}
check("4. every citation carrier field renders inside a disclosure",
  leaked.length === 0, leaked.slice(0, 6).join("\n      "));

// ── CONTROL: the detector is not vacuous ────────────────────────────────────
// ⚠ ALL THREE PINS ABOVE ARE NEGATIVES, so a regex that matched nothing would pass every one of them.
// These prove the detector finds identifiers where they legitimately live.
check("C1. control — the detector finds identifiers inside disclosures",
  citedInPages > 0, `pages cited=${citedInPages} (0 means the regex matches nothing)`);
check("C2. control — the detector finds identifiers inside citation fields",
  citedInLoaders > 0, `loaders cited=${citedInLoaders}`);
check("C3. control — comment blanking preserves line numbers",
  blankComments("a\n// x\nb").split("\n").length === 3
  && blankComments("/* a\nb */\nc").split("\n").length === 3);
// ⚠ A RATCHET WITH NOTHING BEHIND IT IS A PIN THAT CANNOT FAIL. If the legacy scan ever finds zero,
// the baseline is stale and the flat ban should replace it — say so rather than passing quietly.
check("C5. control — the legacy ratchet is measuring something",
  legacyOffenders.length > 0,
  "legacy scan found 0 — drop the ratchet and add these modules to DOCTRINE_MODULES");
check("C4. control — the doctrine this enforces is on disk",
  existsSync("docs/CPR-PD-SCREEN-DOCTRINE.md")
  && /placement, not deletion/i.test(readFileSync("docs/CPR-PD-SCREEN-DOCTRINE.md", "utf8")));

console.log(`\n  identifiers preserved in citation carriers: ${citedInPages + citedInLoaders}`);
console.log(`  identifiers in visible text: ${pageOffenders.length + loaderOffenders.length}\n`);

if (failures.length) {
  console.log(`RED  ${passed} passed, ${failures.length} failed\n`);
  process.exit(1);
}
console.log(`ALL GREEN  ${passed} passed, 0 failed\n`);
