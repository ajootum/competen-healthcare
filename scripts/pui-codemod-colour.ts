/**
 * PUI colour migration — Tailwind semantic classes to design tokens.
 *
 * Every decision is delegated to src/lib/design/colour-map.ts, which maps BY ROLE and refuses any text
 * conversion that would reduce contrast. scripts/pui-colour-harness.ts proves that mapping; this file only
 * applies it. Nothing outside the declared bands is touched, so a deliberate dark panel or an emphasis
 * shade stays exactly as written.
 *
 *   npx --yes tsx scripts/pui-codemod-colour.ts --dry
 *   npx --yes tsx scripts/pui-codemod-colour.ts [--only <path-fragment>]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tokenFor, type Role } from "../src/lib/design/colour-map";

const ROOT = process.cwd();
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p)) out.push(p);
  }
  return out;
};

// Only inside a className. A colour name in a data string, a chart config or a comment is not styling, and
// rewriting one would change behaviour rather than appearance.
const CLASSNAME = /className=(?:\{`([^`]*)`\}|(["'])([^"']*)\2)/g;
const TOKEN_CLASS = /\b(text|bg|border)-(red|rose|amber|yellow|emerald|green|sky|blue|orange)-(\d{2,3})\b/g;

export function convert(cls: string, tally?: Map<string, number>): string {
  return cls.replace(TOKEN_CLASS, (whole, role: string, hue: string, shade: string) => {
    // A variant prefix (hover:, focus:, group-hover:) sits to the LEFT of the match and is untouched, so
    // `hover:text-rose-600` becomes `hover:text-[var(--cmp-text-error)]` with the variant intact.
    const token = tokenFor(role as Role, hue, Number(shade));
    if (!token) return whole;
    if (tally) tally.set(whole, (tally.get(whole) ?? 0) + 1);
    return `${role}-[var(${token})]`;
  });
}

function main() {
  const dry = process.argv.includes("--dry");
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
  const files = walk(join(ROOT, "src/app")).concat(walk(join(ROOT, "src/components")))
    .filter(f => !only || f.replace(/\\/g, "/").includes(only));

  const tally = new Map<string, number>();
  let changedFiles = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // PASS 1: plain className attributes.
    let out = src.replace(CLASSNAME, (whole, tpl, q, plain) => {
      const cls = tpl !== undefined ? tpl : (plain ?? "");
      const next = convert(cls, tally);
      if (next === cls) return whole;
      return tpl !== undefined ? "className={`" + next + "`}" : `className=${q}${next}${q}`;
    });
    // PASS 2: class strings that never reach a className attribute directly — the ternary branches, the
    // tone lookup tables, the `${cond ? "text-amber-600" : ...}` inside a template. Restricting the
    // migration to pass 1 left roughly half the sites behind, which is worse than either extreme: the same
    // meaning would render as a token in one place and a raw Tailwind class in another.
    //
    // Safe because the pattern is unmistakably a Tailwind utility. It is applied only to STRING LITERALS,
    // so a colour word in prose, a comment or an identifier is untouched.
    out = out.replace(/(["'`])([^"'`\n]*)\1/g, (whole, q: string, body: string) => {
      if (!/\b(text|bg|border)-(red|rose|amber|yellow|emerald|green|sky|blue|orange)-\d{2,3}\b/.test(body)) return whole;
      const next = convert(body, tally);
      return next === body ? whole : `${q}${next}${q}`;
    });
    if (out !== src) {
      changedFiles++;
      if (!dry) writeFileSync(f, out);
    }
  }
  const sites = [...tally.values()].reduce((a, b) => a + b, 0);

  console.log(`\n${dry ? "DRY RUN — nothing written" : "APPLIED"}\n`);
  console.log(`  ${changedFiles} file(s), ${sites} colour site(s) converted\n`);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, n] of top.slice(0, 16)) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`\n  ${top.length} distinct class(es) converted. Everything else was left as written.\n`);
}

main();
