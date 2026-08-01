/**
 * Give every audit_log write the request's trace id (XWI P2-15, completion).
 *
 * Five write paths were wired by hand -- the competency/override spine -- leaving 313 others writing audit
 * rows with nothing to join them to the events they caused. The remaining work is mechanical, which is
 * exactly when a codemod beats 313 edits, and exactly when one goes wrong quietly.
 *
 * WHY THIS IS SAFE TO AUTOMATE: TypeScript verifies the result. Pass 1 inserts a reference to `c`, so if
 * `c` is not in scope the build FAILS; pass 2 inserts an `await`, so if the enclosing function is not
 * async the build FAILS. There is no version of this that silently writes a broken file -- the worst case
 * is a compile error naming the exact line. That is the property that separates a codemod from a guess.
 *
 * TWO PASSES, because there are two ways to reach the same id:
 *   1. `c.traceId`               where getCaller() is in scope -- free, no extra await
 *   2. `await currentTraceId()`  everywhere else: routes that authenticate with auth.getUser() directly,
 *      cron routes on a shared secret, and audit() helpers that take an untyped `c: any`
 * Both read the SAME header stamped once per request by src/proxy.ts, so a request that mixes the two
 * still writes one id. That equivalence is what makes pass 2 safe to apply blindly.
 *
 * WHAT IT REFUSES TO TOUCH, rather than guessing:
 *   - inserts already carrying a trace_id (matched to the literal's CLOSING BRACE, not a fixed lookahead --
 *     a 400-char window silently misses trace_id in a long insert and writes a duplicate key)
 *   - "use client" files: next/headers cannot be imported there, and a service-role write in a client
 *     component would be a far worse bug than a missing trace id
 *   - non-async enclosing functions (pass 2 needs somewhere to put the await)
 *   - the .insert([ array form, whose shape this does not attempt to parse
 *
 * Every refusal is COUNTED AND CATEGORISED. A codemod that reports "312 rewritten" without saying what it
 * declined has told you nothing about its own blind spots.
 *
 *   npx --yes tsx scripts/codemod-trace-id.ts            report only
 *   npx --yes tsx scripts/codemod-trace-id.ts --apply    write the changes
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};

type Skip = "already" | "use-client" | "not-async" | "array-form";
const skips: Record<Skip, string[]> = { already: [], "use-client": [], "not-async": [], "array-form": [] };

// End offset of the object literal that opens at `open` (index of its `{`). Brace-counting is crude but
// only has to survive TypeScript object literals -- a `}` inside a string or comment would break it, which
// is why a mismatch (depth never returns to 0) reports -1 and the site is left alone.
function literalEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Is the function enclosing `at` async? Returns null at top level.
//
// Walks OUT through brace depth rather than guessing from the nearest keyword. Two textual heuristics were
// tried first and both were wrong: anchoring on "async function" found the PREVIOUS async function and
// called a plain `function audit()` async (tsc caught it); adding "=>" to the anchors let a stray arrow
// inside an argument list outrank the real `export async function POST` header and called it non-async.
// Nesting is structural, so the check has to be too -- control blocks and object literals are stepped
// over, and only a real function header answers.
function enclosingIsAsync(src: string, at: number): boolean | null {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const ch = src[i];
    if (ch === "}") { depth++; continue; }
    if (ch !== "{") continue;
    if (depth > 0) { depth--; continue; }
    const head = src.slice(Math.max(0, i - 200), i);
    if (/\b(if|for|while|switch|catch|try|else|do)\s*(\([^)]*\))?\s*$/.test(head)) continue; // control block
    if (/=>\s*$/.test(head) || /\bfunction\b[^{}]*$/.test(head)) return /\basync\b[^{}]*$/.test(head);
    continue; // object literal / class body — keep going out
  }
  return null;
}

// Insert `import { currentTraceId } from "@/lib/trace";` after the file's last top-level import.
function addImport(src: string): string {
  if (src.includes("@/lib/trace")) return src;
  const re = /^import\s[\s\S]*?;\s*$/gm;
  let last: RegExpExecArray | null = null, m: RegExpExecArray | null;
  while ((m = re.exec(src))) last = m;
  if (!last) return `import { currentTraceId } from "@/lib/trace";\n` + src;
  const at = last.index + last[0].length;
  return src.slice(0, at) + `\nimport { currentTraceId } from "@/lib/trace";` + src.slice(at);
}

function main() {
  const apply = process.argv.includes("--apply");
  let viaCaller = 0, viaHeader = 0, filesChanged = 0;

  for (const file of walk(SRC)) {
    let src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (!src.includes('from("audit_log")')) continue;

    const isClient = /^\s*["']use client["']/.test(src);
    let changed = false, needsImport = false;

    // Rebuild the file left to right so offsets stay valid as text is inserted.
    let out = "";
    let cursor = 0;
    const re = /\.from\(\s*"audit_log"\s*\)\s*\.insert\s*\(\s*([{[])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const openChar = m[1];
      const insertAt = m.index + m[0].length;      // just past the { or [
      const label = `${rel}:${src.slice(0, m.index).split("\n").length}`;

      if (openChar === "[") { skips["array-form"].push(label); continue; }

      // Already traced? Test the WHOLE literal, not a fixed window.
      const end = literalEnd(src, insertAt - 1);
      if (end < 0) { skips["array-form"].push(label + " (unbalanced)"); continue; }
      if (/\btrace_id\s*:/.test(src.slice(insertAt, end))) { skips.already.push(label); continue; }

      if (isClient) { skips["use-client"].push(label); continue; }

      // Pass 1: `c` in scope? Require the nearest preceding top-level function to call getCaller.
      const before = src.slice(0, m.index);
      const fnStart = Math.max(
        before.lastIndexOf("export async function"),
        before.lastIndexOf("export function"),
        before.lastIndexOf("async function"),
      );
      const inCallerFn = fnStart >= 0 && /\bgetCaller\s*\(/.test(src.slice(fnStart, m.index));

      if (inCallerFn) {
        out += src.slice(cursor, insertAt) + " trace_id: c.traceId,";
        cursor = insertAt;
        viaCaller++; changed = true;
        continue;
      }

      // Pass 2: read the request header. Needs an async enclosing function to hold the await.
      if (enclosingIsAsync(src, m.index) !== true) { skips["not-async"].push(label); continue; }

      out += src.slice(cursor, insertAt) + " trace_id: await currentTraceId(),";
      cursor = insertAt;
      viaHeader++; changed = true; needsImport = true;
    }
    if (changed) {
      out += src.slice(cursor);
      src = needsImport ? addImport(out) : out;
      filesChanged++;
      if (apply) writeFileSync(file, src);
    }
  }

  console.log(`\nTrace-id codemod ${apply ? "(APPLIED)" : "(dry run — pass --apply to write)"}\n`);
  console.log(`  ${viaCaller + viaHeader} insert(s) rewritten across ${filesChanged} file(s)`);
  console.log(`     ${String(viaCaller).padStart(4)}  via c.traceId          (getCaller in scope)`);
  console.log(`     ${String(viaHeader).padStart(4)}  via currentTraceId()   (reads the proxy header)\n`);
  console.log(`  Declined, by reason — these are the blind spots, not a clean bill of health:`);
  for (const [k, v] of Object.entries(skips)) {
    console.log(`    ${String(v.length).padStart(4)}  ${k}`);
    if (k !== "already" && v.length) for (const s of v.slice(0, 8)) console.log(`            ${s}`);
    if (k !== "already" && v.length > 8) console.log(`            ... and ${v.length - 8} more`);
  }
  console.log(`\n  TypeScript is the verifier: \`c\` out of scope, or an await with no async, fails the build.\n`);

  // --check turns the report into a GATE. Once every audit write is traced, the only thing that can undo
  // it is a new route written without one, and a tool that merely reports will not catch that -- someone
  // has to run it and read the number. Non-zero exit is what makes it survive.
  if (process.argv.includes("--check")) {
    const untraced = viaCaller + viaHeader + skips["not-async"].length + skips["use-client"].length + skips["array-form"].length;
    if (untraced > 0) {
      console.error(`  FAIL: ${untraced} audit_log insert(s) carry no trace id. Run with --apply.\n`);
      process.exit(1);
    }
    console.log(`  PASS: all ${skips.already.length} audit_log inserts carry a trace id.\n`);
  }
}

main();
