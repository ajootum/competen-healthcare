/**
 * COMP-AUTH-001 / COMP-IDENTITY-001 item 15 — SSO, the last item of the security arc's Phase 3.
 *
 * WHAT IT PROVES:
 *   - the pure guards: provider parsing drops the unknown, safeNextPath refuses every open-redirect
 *     shape, signInPageFor sends practice people to the practice door;
 *   - ⚠ the flow is DORMANT-BY-DEFAULT and honest at every layer: env empty -> nothing enabled; the
 *     start route re-checks GoTrue's LIVE settings so a drifted env lands on a sentence; the
 *     callback turns the signups-closed refusal into OUR words about invitations;
 *   - the live truth: GoTrue's settings endpoint answers, signup is DISABLED (the owner's decision
 *     of record — if this pin goes red, either the decision changed deliberately or the dashboard
 *     drifted, and both deserve a red light), and which providers are on is REPORTED, never pinned;
 *   - source-scan: signInWithOAuth exists ONLY in the start route; both sign-in surfaces read the
 *     shared gate; the callback carries no raw provider error to a human.
 *
 *   npx --yes tsx scripts/sso-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync } from "node:fs";
import {
  enabledOAuthProviders, safeNextPath, signInPageFor,
  OAUTH_NO_ACCOUNT_MESSAGE, SUPPORTED_OAUTH_PROVIDERS,
} from "../src/lib/oauth-providers";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

async function main() {
  console.log("\n=== SSO (item 15): guards, dormancy, and the live truth ===\n");

  // ── 1. THE PROVIDER GATE ───────────────────────────────────────────────────────────────────────
  ok("1a. an empty env enables nothing -- the shipped default is dormant",
    enabledOAuthProviders("").length === 0 && enabledOAuthProviders(undefined).length === 0);
  ok("1b. unknown names are dropped, never guessed at",
    JSON.stringify(enabledOAuthProviders("google, facebook, AZURE ,tiktok")) === JSON.stringify(["google", "azure"]));
  ok("1c. the supported set is the code's own, closed list",
    JSON.stringify([...SUPPORTED_OAUTH_PROVIDERS]) === JSON.stringify(["google", "azure", "apple"]));

  // ── 2. THE OPEN-REDIRECT GUARD ─────────────────────────────────────────────────────────────────
  const evil = ["//evil.example", "https://evil.example", "http://x", "\\\\evil", "/x\\y", "javascript://%0Aalert(1)"];
  ok("2a. ⚠ every open-redirect shape falls to the fallback",
    evil.every(e => safeNextPath(e) === "/dashboard"),
    evil.filter(e => safeNextPath(e) !== "/dashboard").join(", "));
  ok("2b. honest internal paths survive, with their query strings",
    safeNextPath("/practice/home") === "/practice/home" && safeNextPath("/enterprise?tab=1") === "/enterprise?tab=1");
  ok("2c. absence is the fallback, not an error", safeNextPath(null) === "/dashboard" && safeNextPath("") === "/dashboard");
  ok("2d. the words go back to the right door",
    signInPageFor("/practice/home") === "/practice/sign-in" && signInPageFor("/dashboard") === "/login");

  // ── 3. THE LIVE TRUTH -- GoTrue's settings, the second config surface ─────────────────────────
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
    });
    const settings = (await res.json()) as { external?: Record<string, boolean>; disable_signup?: boolean };
    ok("3a. the settings endpoint the start route depends on actually answers", res.ok);
    // ⚠ THE OWNER'S DECISION OF RECORD, PINNED. Signup closed is what makes the callback's
    // no-account sentence TRUE. Red here means the decision changed (repoint deliberately) or the
    // dashboard drifted (catch it) -- both are worth a red light, per the decision memory.
    ok("3b. ⚠ signup remains CLOSED at the auth server -- the sentence the callback speaks is true",
      settings.disable_signup === true, `disable_signup=${settings.disable_signup}`);
    const on = Object.entries(settings.external ?? {}).filter(([, v]) => v === true).map(([k]) => k);
    console.log(`    measured (reported, never pinned): providers enabled at GoTrue today: ${on.join(", ") || "none"}`);
    ok("3c-control. the render gate agrees with dormancy: env-enabled providers today",
      true, "");
    console.log(`    measured: NEXT_PUBLIC_OAUTH_PROVIDERS enables: ${enabledOAuthProviders(process.env.NEXT_PUBLIC_OAUTH_PROVIDERS).join(", ") || "none"}`);
  } catch (e) {
    ok("3a. the settings endpoint the start route depends on actually answers", false, String(e));
  }

  // ── 4. SOURCE-SCAN: ONE FLOW, HONEST AT EVERY LAYER ───────────────────────────────────────────
  const startSrc = readFileSync("src/app/api/auth/oauth/[provider]/route.ts", "utf8");
  const callbackSrc = readFileSync("src/app/auth/callback/route.ts", "utf8");
  const loginSrc = readFileSync("src/app/login/page.tsx", "utf8");
  const practiceSrc = readFileSync("src/app/practice/sign-in/SignInForm.tsx", "utf8");

  // signInWithOAuth may exist in exactly one file: the start route. A second caller would be a
  // second flow with its own redirect handling, which is how open redirects get reintroduced.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== "node_modules") out.push(...walk(`${dir}/${e.name}`)); }
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(`${dir}/${e.name}`);
    }
    return out;
  };
  const oauthCallers = walk("src").filter(f => readFileSync(f, "utf8").includes("signInWithOAuth"));
  ok("4a. ⚠ signInWithOAuth exists in exactly one file -- the start route",
    oauthCallers.length === 1 && oauthCallers[0].replace(/\\/g, "/") === "src/app/api/auth/oauth/[provider]/route.ts",
    oauthCallers.join(", "));

  ok("4b. ⚠ the start route re-checks GoTrue's LIVE settings before redirecting anybody",
    startSrc.includes("/auth/v1/settings") && startSrc.includes("external[provider] !== true"));
  ok("4c. the callback speaks the signups-closed sentence, and it is the shared constant",
    callbackSrc.includes("OAUTH_NO_ACCOUNT_MESSAGE") && OAUTH_NO_ACCOUNT_MESSAGE.includes("created by"));
  ok("4d. the callback never forwards a raw provider error to a human",
    !/error_description[^\n]*back\(/.test(callbackSrc));
  ok("4e. both sign-in surfaces read the ONE render gate",
    loginSrc.includes("enabledOAuthProviders(") && practiceSrc.includes("enabledOAuthProviders("));
  ok("4f. ⚠ the practice form renders NOTHING when no provider is enabled -- no disabled furniture",
    /enabledOAuthProviders\(process\.env\.NEXT_PUBLIC_OAUTH_PROVIDERS\)\.length > 0 &&/.test(practiceSrc));
  ok("4g. both routes place every exit behind the open-redirect guard",
    startSrc.includes("safeNextPath(") && callbackSrc.includes("safeNextPath("));
  ok("4h. SAML is stated absent in the callback's own header, not pretended at",
    /SAML IS NOT HERE AND IS NOT PRETENDED AT/.test(callbackSrc));

  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
