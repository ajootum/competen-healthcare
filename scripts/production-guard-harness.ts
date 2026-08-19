/**
 * The production-target guard, proven — COMP-ENG-002H Track B.
 *
 * ⚠ THE GUARD WAS UNVERIFIED FOR A REASON WORTH REMEMBERING. It was written, reviewed, and twice found
 * to be silently inert: once because `page.route()`'s promise was discarded so the interceptor might
 * never install, and once because a path-oriented glob cannot match a project id that lives in the
 * HOST. Both times it reported "no violation" — not because nothing was wrong, but because it was not
 * running. A control that has never been seen to refuse anything is a claim, not a control.
 *
 * ⚠ NO NETWORK, EVER. §5: "Inject/mock production identity; never point the negative test at live
 * production." Every case here is a pure predicate call or a fake Playwright route driven by hand. The
 * production ref is used as DATA, never as a destination — nothing in this file can open a socket.
 *
 * ⚠ IT TESTS THE REAL PATH, NOT A COPY. scripts/production-guard.ts is the single predicate that
 * provision-staging-fixture.ts and the smoke helper both call, and blockProductionTraffic is imported
 * from the suite itself. A negative test that re-implemented the rule would prove only that the
 * re-implementation works.
 */
import { blockProductionTraffic } from "../e2e/helpers/synthetic-practitioner";
import { PRODUCTION_REF, isProductionUrl, judgeTarget, refOf } from "./production-guard";

const STAGING = "https://ezhvpgtcqcdsgylrxgdb.supabase.co";
const SYNTHETIC = "https://abcdefghijklmnopqrst.supabase.co";
const PRODUCTION = `https://${PRODUCTION_REF}.supabase.co`;

let failures = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const check = (label: string, cond: boolean, detail = "") =>
  cond ? ok(label) : bad(`${label}${detail ? ` — ${detail}` : ""}`);

console.log("\n=== production-target guard: the §5 matrix ===\n");

// ── §5 rows 1-2: permitted targets ───────────────────────────────────────────────────────────────
console.log("PERMITTED");
check("a known staging target is permitted", judgeTarget(STAGING).ok);
check("a synthetic non-production target is permitted", judgeTarget(SYNTHETIC).ok);

// ── §5 rows 3-4: simulated production, by ref and by URL ─────────────────────────────────────────
console.log("\nREFUSED — simulated production identity");
const byUrl = judgeTarget(PRODUCTION);
check("a simulated production Supabase URL is refused",
  !byUrl.ok && byUrl.reason === "PRODUCTION", `got ${JSON.stringify(byUrl)}`);
check("the refusal names the production ref it recognised", byUrl.ref === PRODUCTION_REF);
check("a bare production project ref resolves to production", refOf(PRODUCTION) === PRODUCTION_REF);

// ── §5 row 5: a staging-looking URL carrying the production identifier ───────────────────────────
// The ref is what decides, not the shape of the string around it.
const disguised = [
  `https://${PRODUCTION_REF}.supabase.co/rest/v1/`,
  `https://${PRODUCTION_REF}.supabase.co?pretend=staging`,
  `https://${PRODUCTION_REF}.supabase.co/auth/v1/token?grant_type=password`,
];
console.log("\nREFUSED — production identifier inside an otherwise plausible target");
for (const u of disguised) {
  const v = judgeTarget(u);
  check(`refused: ${u.replace(PRODUCTION_REF, "<prod-ref>")}`, !v.ok && v.reason === "PRODUCTION");
}

// ── §5 row 6: missing or unidentifiable environment identity fails CLOSED ────────────────────────
console.log("\nREFUSED — missing or unidentifiable identity (fail closed)");
for (const [label, value] of [
  ["undefined", undefined],
  ["empty string", ""],
  ["a dashboard link", "https://supabase.com/dashboard/project/ezhvpgtcqcdsgylrxgdb"],
  ["a bare hostname", "ezhvpgtcqcdsgylrxgdb"],
  ["a non-Supabase URL", "https://example.com"],
] as Array<[string, string | undefined]>) {
  const v = judgeTarget(value);
  check(`${label} is refused as UNIDENTIFIABLE`, !v.ok && v.reason === "UNIDENTIFIABLE", JSON.stringify(v));
}

// ── §5 row 7: no undocumented bypass ─────────────────────────────────────────────────────────────
// The predicate takes only a URL. It reads no environment variable, no flag and no argument, so there
// is nothing to set that would make it permit production.
console.log("\nNO BYPASS");
const savedEnv = { ...process.env };
process.env.SKIP_PRODUCTION_GUARD = "1";
process.env.ALLOW_PRODUCTION = "true";
process.env.CI = "1";
const underPressure = judgeTarget(PRODUCTION);
check("production is still refused with bypass-looking env vars set",
  !underPressure.ok && underPressure.reason === "PRODUCTION");
process.env = savedEnv;

// ── The request-level block: the half that was twice inert ───────────────────────────────────────
console.log("\nREQUEST-LEVEL BLOCK (the real handler, driven by a fake route)");

type Recorded = { pattern: RegExp | string; handler: (route: any) => Promise<void> };
async function driveHandler(url: string): Promise<{ aborted: boolean; continued: boolean; matched: boolean; violation: string | null }> {
  const recorded: Recorded[] = [];
  const fakePage = { route: async (pattern: any, handler: any) => { recorded.push({ pattern, handler }); } };
  const guard = await blockProductionTraffic(fakePage as never);
  if (recorded.length !== 1) return { aborted: false, continued: false, matched: false, violation: null };
  const { pattern, handler } = recorded[0];
  const matched = pattern instanceof RegExp ? pattern.test(url) : false;
  let aborted = false, continued = false;
  await handler({
    request: () => ({ url: () => url }),
    abort: async () => { aborted = true; },
    continue: async () => { continued = true; },
  });
  return { aborted, continued, matched, violation: guard.violation() };
}

async function main() {
  const prodReq = await driveHandler(`${PRODUCTION}/auth/v1/token?grant_type=password`);
  check("the interceptor is actually REGISTERED (it was silently not, twice)", prodReq.matched || prodReq.aborted);
  check("a production auth request is ABORTED, not continued", prodReq.aborted && !prodReq.continued,
    `aborted=${prodReq.aborted} continued=${prodReq.continued}`);
  check("the abort happens BEFORE any network dispatch", prodReq.aborted,
    "Playwright's route.abort() prevents the request being sent at all");
  check("the violation is reported to the caller", prodReq.violation !== null);
  check("the violation names a host, never a credential",
    prodReq.violation !== null && !/token|password|key|secret|eyJ/i.test(prodReq.violation));

  const stagingReq = await driveHandler(`${STAGING}/auth/v1/token?grant_type=password`);
  check("a staging request is allowed through", stagingReq.continued && !stagingReq.aborted,
    `aborted=${stagingReq.aborted} continued=${stagingReq.continued}`);
  check("an allowed request records no violation", stagingReq.violation === null);

  // ── The URL-level predicate used by that handler ─────────────────────────────────────────────────
  console.log("\nisProductionUrl");
  check("matches a production URL", isProductionUrl(`${PRODUCTION}/rest/v1/x`));
  check("does not match staging", !isProductionUrl(`${STAGING}/rest/v1/x`));
  check("does not match a lookalike host that merely CONTAINS the ref",
    !isProductionUrl(`https://not-${PRODUCTION_REF}.example.com/`));
  check("does not match garbage", !isProductionUrl("not a url"));

  console.log(`\n${failures === 0 ? "ALL GREEN — the guard refuses simulated production, without touching the network"
    : `RED  ${failures} failure(s)`}\n`);
  process.exit(failures === 0 ? 0 : 1);

}

main();
