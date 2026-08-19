/**
 * COMP-ENG-002H Track A — the two configs that must agree about the dev origin.
 *
 * ⚠ THIS INVARIANT SPANS TWO FILES, WHICH IS WHY IT NEEDS A HARNESS. Neither file is wrong on its own:
 *
 *   playwright.config.ts  drives the app at 127.0.0.1, deliberately, because on Linux `localhost` can
 *                         resolve to ::1 while `next dev` listens on IPv4 — a failure that cannot
 *                         reproduce on Windows and therefore reached CI once already.
 *   next.config.ts        must then list 127.0.0.1 in allowedDevOrigins, because Next 16 blocks
 *                         cross-origin requests to dev assets and allows only the hostname the server
 *                         was initialised with (localhost).
 *
 * With the first and without the second, a Next runtime chunk is refused to the BROWSER (403) while
 * curl still gets 200 — because curl sends no Origin header. React then never hydrates, and the
 * sign-in form becomes inert markup whose submit button performs a native GET. Measured 2026-08-19:
 * four authenticated journeys failed for two days of elapsed investigation, presenting variously as a
 * navigation timeout, a locator timeout, and "no Supabase request was ever made".
 *
 * ⚠ WHAT THIS DOES NOT DO. It does not assert that any particular origin is ALLOWED beyond the loopback
 * one, and it fails if a wildcard appears. Widening allowedDevOrigins is a security decision about who
 * may reach a development server, and it should not be possible to make it by accident while fixing a
 * test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const nextConfig = readFileSync(join(ROOT, "next.config.ts"), "utf8");
const pwConfig = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");

let failures = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };

console.log("\n=== dev origin agreement (COMP-ENG-002H Track A) ===\n");

// Strip comments so a mention inside the explanatory block above cannot satisfy the check. This
// codebase has repeatedly had assertions pass on their own prose.
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const nextCode = code(nextConfig);
const pwCode = code(pwConfig);

const declared = nextCode.match(/allowedDevOrigins\s*:\s*\[([^\]]*)\]/);
if (!declared) {
  bad("next.config.ts declares no allowedDevOrigins — a browser on 127.0.0.1 will be refused its dev chunks");
} else {
  const origins = [...declared[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map(m => m[1]);
  ok(`allowedDevOrigins declared: ${origins.join(", ") || "(empty)"}`);
  if (!origins.some(o => o === "127.0.0.1")) {
    bad(`allowedDevOrigins does not include "127.0.0.1" — that is the origin the smoke suite uses`);
  } else ok(`includes 127.0.0.1, which is what the Playwright base URL resolves to`);
  const wild = origins.filter(o => o.includes("*"));
  if (wild.length) bad(`WILDCARD origin(s) present: ${wild.join(", ")}. Widening who may reach a dev server is a security decision, not a test fix.`);
  else ok("no wildcard origins");
}

// The other half: if the suite stops using 127.0.0.1, the entry above is dead config rather than a fix.
const baseUrl = pwCode.match(/baseURL:\s*process\.env\.PLAYWRIGHT_BASE_URL\s*\?\?\s*["'`]([^"'`]+)["'`]/);
if (!baseUrl) bad("could not read the Playwright default baseURL — this harness cannot confirm the pair agree");
else if (!baseUrl[1].includes("127.0.0.1")) {
  bad(`Playwright's default baseURL is ${baseUrl[1]}, not 127.0.0.1. `
    + `Either restore it, or remove the now-unnecessary allowedDevOrigins entry — but do not leave the two disagreeing.`);
} else ok(`Playwright default baseURL is ${baseUrl[1]}`);

console.log(`\n${failures === 0 ? "ALL GREEN" : `RED  ${failures} failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
