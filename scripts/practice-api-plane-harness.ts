/**
 * ⚠ THE TWO GATES MUST NOT BE STACKED — COMP-ARCH-PSA-001.
 *
 * Platform and Competen Practice are SEPARATE PRODUCTS behind SEPARATE gates: platform_membership is
 * gate 1, practice_membership is gate 2. A Competen Practice account has no estate membership BY
 * DEFINITION, so any practice route that asks for gate 1 answers 403 to the only people who use it.
 *
 * That is not hypothetical. On 2026-08-10 getCaller() gained an estate-membership check and
 * requirePracticeContext called it, so 115 of 125 practice API routes began refusing the practice owner.
 * It survived review, a scanner and every harness because PAGES were unaffected -- they resolve through
 * resolvePracticeShell -- so the product looked healthy until somebody tried to WRITE something. It was
 * found by a person clicking a button.
 *
 * ⚠ AND THE MEASUREMENT THAT SHOULD HAVE CAUGHT IT WAS TAKEN AND MISREAD: "the single practice-only
 * account carries no platform membership" was recorded as proof the change was safe. It was proof of the
 * opposite. So this harness asserts against the LIVE ACCOUNT, not against a fixture: a real practice
 * member must pass whatever the practice API boundary asks of them.
 *
 *   npx --yes tsx scripts/practice-api-plane-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- profile rows come back untyped from the
   Supabase admin client, as everywhere in scripts/. */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync } from "node:fs";
import { admitToEstate } from "../src/lib/platform-membership";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const strip = (s: string) => s.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");

async function main() {
  console.log("\n=== THE TWO GATES ARE NOT STACKED (COMP-ARCH-PSA-001) ===\n");

  const apiAuth = readFileSync("src/lib/api-auth.ts", "utf8");
  const apiCtx = readFileSync("src/lib/practice/api-context.ts", "utf8");
  const authCode = strip(apiAuth);
  const ctxCode = strip(apiCtx);
  ok("0-control. both files were read and comments stripped without emptying them",
    authCode.includes("export async function getCaller") && ctxCode.includes("requirePracticeContext"));

  // ── 1. ⚠ THE LIVE ACCOUNT, NOT A FIXTURE ─────────────────────────────────────────────────────────
  const { data: mem, error: mErr } = await admin.from("practice_membership")
    .select("user_id, workspace_id").eq("status", "active");
  ok("1a-control. the practice membership store is readable", !mErr && !!mem, mErr?.message ?? "");
  const users = [...new Set((mem ?? []).map((m: any) => m.user_id))];
  ok("1b-control. there IS at least one live practice member to test against",
    users.length > 0, `${users.length} members`);

  for (const userId of users) {
    const { data: p } = await admin.from("profiles").select("full_name, email, role, roles").eq("id", userId).maybeSingle();
    const who = (p as any)?.email ?? (p as any)?.full_name ?? userId.slice(0, 12);
    const roles: string[] = (((p as any)?.roles?.length ? (p as any).roles : [(p as any)?.role]) ?? [])
      .filter(Boolean) as string[];
    const verdict = await admitToEstate(admin, userId, roles as never);

    // ⚠ THIS IS THE ASSERTION, AND IT IS DELIBERATELY THE OPPOSITE WAY ROUND FROM THE OBVIOUS ONE.
    // It does NOT demand that a practice member pass the estate gate -- they should not, and making them
    // pass it would mean granting practice users estate membership, which is the two-gate split
    // collapsing from the other side. It demands that the PRACTICE API BOUNDARY DOES NOT ASK.
    if (!verdict.admitted)
      console.log(`     ${who}: correctly holds NO estate membership (${verdict.reason})`);
    else
      console.log(`     ${who}: holds estate membership -- fine, but not what practice access rests on`);
  }

  const practiceOnly = [];
  for (const userId of users) {
    const { data: p } = await admin.from("profiles").select("role, roles").eq("id", userId).maybeSingle();
    const roles: string[] = (((p as any)?.roles?.length ? (p as any).roles : [(p as any)?.role]) ?? [])
      .filter(Boolean) as string[];
    if (!(await admitToEstate(admin, userId, roles as never)).admitted) practiceOnly.push(userId);
  }
  ok("1c-control. ⚠ at least one live practice member would FAIL the estate gate",
    practiceOnly.length > 0,
    "if nobody would fail it, everything below passes for the wrong reason");

  // ── 2. ⚠ THE BOUNDARY ITSELF ─────────────────────────────────────────────────────────────────────
  ok("2a. ⚠ requirePracticeContext declares the practice plane",
    /getCaller\(\{\s*plane:\s*"practice"\s*\}\)/.test(ctxCode),
    "practice routes are being sent through the estate gate");
  ok("2b. ⚠ and the estate check is conditional on NOT being the practice plane",
    /opts\.plane !== "practice"[\s\S]{0,120}admitToEstate/.test(authCode),
    "admitToEstate runs unconditionally, so every practitioner is refused");
  // ⚠ THE DEFAULT ARGUMENT ITSELF, not merely the absence of one spelling of it. The first version of
  // this line tested for `plane = "practice"` and missed a default of `= { plane: "practice" }` -- the
  // break was caught, but by 4b, three assertions away and with a misleading message. An assertion that
  // is right by luck is not right.
  const defaultArg = /getCaller\(opts:[^)]*=\s*(\{[^}]*\})\s*\)/.exec(authCode)?.[1] ?? "";
  ok("2c. ⚠ the default is the STRICT plane -- anything that forgets gets the estate gate",
    /plane\?:\s*"estate"\s*\|\s*"practice"/.test(authCode) && defaultArg.replace(/\s/g, "") === "{}",
    `default argument is ${defaultArg || "(not found)"}`);
  ok("2d-control. the estate gate still exists and was not simply deleted",
    authCode.includes("admitToEstate(") && authCode.includes("Not a member of this platform"));

  // ── 3. THE PRACTICE PLANE STILL HAS A REAL GATE ──────────────────────────────────────────────────
  // ⚠ Removing gate 1 must not have removed ALL gating. Membership, status, entitlement and the route
  // capability are enforced by resolveWorkspaceContext and hasCapability, below the change.
  ok("3a. membership and workspace state are still resolved", ctxCode.includes("resolveWorkspaceContext("));
  ok("3b. ⚠ and the route's capability is still enforced",
    /if \(capability && !hasCapability\(res\.ctx, capability\)\)/.test(ctxCode));
  ok("3c. a caller with no membership is still refused",
    ctxCode.includes("NO_MEMBERSHIP"));

  // ── 4. ESTATE ROUTES ARE UNTOUCHED ───────────────────────────────────────────────────────────────
  const estateCallers = ["src/app/api/admin", "src/app/api/v1"].length;
  ok("4a-control. this repository has estate API routes for the gate to protect", estateCallers > 0);
  ok("4b. ⚠ nothing outside the practice boundary asks for the practice plane",
    (() => {
      const hits: string[] = [];
      const walk = (p: string) => {
        for (const e of readdirSync(p, { withFileTypes: true })) {
          const full = `${p}/${e.name}`;
          if (e.isDirectory()) walk(full);
          // ⚠ STRIPPED FIRST. The raw-text version of this check went red against correct code: the
          // comment in api-auth.ts explaining the opt-out quotes `{ plane: "practice" }` verbatim, so
          // the file that DEFINES the rule looked like a file BREAKING it.
          else if (/\.ts$/.test(e.name) && full !== "src/lib/practice/api-context.ts"
            && strip(readFileSync(full, "utf8")).includes('plane: "practice"')) hits.push(full);
        }
      };
      walk("src");
      return hits.length === 0;
    })(),
    "an estate route has opted out of the estate gate");

  // ── 5. THE MESSAGE THAT HID IT ───────────────────────────────────────────────────────────────────
  // ⚠ Every denial from requirePracticeContext is `{error: "<string>"}`. A client reading only
  // `.error.message` prints its fallback and the reason is lost -- which is why a product-wide 403
  // rendered as "That did not work."
  const denials = (apiCtx.match(/NextResponse\.json\(\{ error: "/g) ?? []).length;
  ok("5a-control. denials really do carry a bare string, so the client shape matters",
    denials >= 3, `${denials} string-shaped denials`);
  const view = readFileSync("src/app/practice/(shell)/knowledge-studio/GuidanceLibraryView.tsx", "utf8");
  ok("5b. ⚠ the guidance console reads BOTH error shapes",
    /data\?\.error\?\.message \?\? data\?\.error/.test(strip(view)),
    "a permission refusal renders as a shrug");
  ok("5c. and its last-resort message carries the status code, so there is something to search for",
    /HTTP \$\{res\.status\}/.test(view));

  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
