/**
 * Give every audit_log write the request's trace id (XWI P2-15, completion).
 *
 * Five write paths were wired by hand -- the competency/override spine -- leaving 313 others writing audit
 * rows with nothing to join them to the events they caused. The remaining work is mechanical, which is
 * exactly when a codemod beats 313 edits, and exactly when one goes wrong quietly.
 *
 * WHY THIS IS SAFE TO AUTOMATE: TypeScript verifies the result. The rewrite inserts a reference to `c`,
 * so if `c` is not in scope at that point the build FAILS. There is no version of this that silently
 * writes a broken file -- the worst case is a compile error naming the exact line. That is the property
 * that makes the difference between a codemod and a guess.
 *
 * WHAT IT REFUSES TO TOUCH, rather than guessing:
 *   - inserts already carrying a trace_id
 *   - files with no getCaller() at all (cron routes authenticate with a shared secret and have no request
 *     caller; server components build their own admin client)
 *   - inserts whose enclosing exported function does not itself call getCaller -- a helper further down
 *     the file has no `c`, and assuming otherwise is how a codemod turns into 40 compile errors
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

type Skip = "already" | "no-caller-in-file" | "not-in-a-caller-function" | "array-form";
const skips: Record<Skip, string[]> = { already: [], "no-caller-in-file": [], "not-in-a-caller-function": [], "array-form": [] };

function main() {
  const apply = process.argv.includes("--apply");
  let rewritten = 0, filesChanged = 0;

  for (const file of walk(SRC)) {
    let src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (!src.includes('from("audit_log")')) continue;

    const hasCaller = /\bgetCaller\s*\(/.test(src);
    let changed = false;

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
      // Look ahead a little for an existing trace_id in this object literal.
      if (/trace_id\s*:/.test(src.slice(insertAt, insertAt + 400))) { skips.already.push(label); continue; }
      if (!hasCaller) { skips["no-caller-in-file"].push(label); continue; }

      // Is `c` actually in scope? Require the nearest preceding top-level function to call getCaller.
      const before = src.slice(0, m.index);
      const fnStart = Math.max(
        before.lastIndexOf("export async function"),
        before.lastIndexOf("export function"),
        before.lastIndexOf("async function"),
      );
      if (fnStart < 0 || !/\bgetCaller\s*\(/.test(src.slice(fnStart, m.index))) {
        skips["not-in-a-caller-function"].push(label);
        continue;
      }

      out += src.slice(cursor, insertAt) + " trace_id: c.traceId,";
      cursor = insertAt;
      rewritten++; changed = true;
    }
    if (changed) {
      out += src.slice(cursor);
      src = out;
      filesChanged++;
      if (apply) writeFileSync(file, src);
    }
  }

  console.log(`\nTrace-id codemod ${apply ? "(APPLIED)" : "(dry run — pass --apply to write)"}\n`);
  console.log(`  ${rewritten} insert(s) rewritten across ${filesChanged} file(s)\n`);
  console.log(`  Declined, by reason — these are the blind spots, not a clean bill of health:`);
  for (const [k, v] of Object.entries(skips)) {
    console.log(`    ${String(v.length).padStart(4)}  ${k}`);
    if (k !== "already" && v.length) for (const s of v.slice(0, 6)) console.log(`            ${s}`);
    if (k !== "already" && v.length > 6) console.log(`            ... and ${v.length - 6} more`);
  }
  console.log(`\n  TypeScript is the verifier: any rewrite where \`c\` is not in scope fails the build.\n`);
}

main();
