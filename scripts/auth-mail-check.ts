/**
 * SUPABASE AUTH MAIL + REDIRECT ALLOWLIST — the half mail-send-check.ts cannot reach.
 *
 *   npx tsx scripts/auth-mail-check.ts <email>            # allowlist probe only, sends nothing
 *   npx tsx scripts/auth-mail-check.ts <email> --send
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * mail-send-check.ts proves the APPLICATION stack (notifications, practice messaging, patient codes).
 * This proves the OTHER system: Supabase's own mailer, which sends signup confirmations, invitations
 * and password resets, and which is configured in the Supabase dashboard rather than in this repo.
 *
 * ⚠ IT TESTS TWO THINGS AT ONCE, DELIBERATELY, BECAUSE THEY FAIL IDENTICALLY FROM A BROWSER.
 *
 *   1. Is the gateway origin on Supabase's redirect allowlist? A redirect_to that is not allowlisted
 *      is REFUSED BEFORE ANY MAIL IS ATTEMPTED -- which is the property that makes this checkable
 *      without spamming anybody. Nothing here could verify the allowlist before: project config needs
 *      a management token and the service-role key gets 401.
 *   2. Does Supabase's mailer actually deliver? Only answerable by sending.
 *
 * "No email arrived" is the symptom of BOTH a missing allowlist entry and unconfigured SMTP, and they
 * have completely different fixes.
 *
 * ⚠ THE PROBE USES AN ADDRESS THAT DOES NOT EXIST. Supabase validates redirect_to before it looks up
 * the account, so an unknown address reveals the allowlist without dispatching mail to a real person
 * or consuming send quota. Only `--send` uses the address you passed.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */

import { createRequire } from "node:module";
const require2 = createRequire(process.cwd() + "/");
const { loadEnvConfig } = require2("@next/env");
loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import { GATEWAYS, GATEWAY_KEYS, COMPETEN_DOMAIN } from "../src/lib/identity/domains";

const target = process.argv[2];
const doSend = process.argv.includes("--send");
if (!target) { console.log("\n  usage: npx tsx scripts/auth-mail-check.ts <email> [--send]\n"); process.exit(1); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(url, anon, { auth: { persistSession: false } });

/** An address that cannot exist, so the probe never mails a real person. */
const NOBODY = "no-such-account-4b81ff@example.invalid";

const line = (state: string, label: string, detail = "") =>
  console.log(`  ${state.padEnd(10)} ${label.padEnd(46)} ${detail}`);

async function main() {
  console.log(`\nSupabase Auth mail — project ${url.replace(/https:\/\/([a-z0-9]+)\..*/, "$1")}\n`);
  console.log("Redirect allowlist (probed with an address that does not exist — no mail sent)\n");

  const problems: string[] = [];

  // Every origin the deployment actually serves, plus one that must be REFUSED. Without the control a
  // permissive allowlist ("*") would read as eight successes and prove nothing.
  const origins = [
    ...GATEWAY_KEYS.map(k => ({ label: GATEWAYS[k].host, origin: `https://${GATEWAYS[k].host}` })),
    // ⚠ FROM THE REGISTRY, NOT A LITERAL. domain-registry-harness 8a caught this file writing the apex
    // by hand -- the containment rule that keeps one shared configuration source honest. The apex is a
    // real auth origin (it serves /login and /auth/callback) even though it is deliberately NOT a
    // gateway: it is the patient booking address, carved out by s4.
    { label: `${COMPETEN_DOMAIN} (apex)`, origin: `https://${COMPETEN_DOMAIN}` },
  ];

  for (const { label, origin } of origins) {
    const { error } = await db.auth.resetPasswordForEmail(NOBODY, { redirectTo: `${origin}/reset-password` });
    const refusedRedirect = !!error && /redirect|not allowed|invalid/i.test(error.message);
    line(refusedRedirect ? "NOT ALLOW" : "allowed", label, refusedRedirect ? error!.message.slice(0, 60) : "");
    if (refusedRedirect) problems.push(`${origin} is not on the redirect allowlist.`);
  }

  // ⚠ THE PROBE ABOVE CANNOT ACTUALLY TEST THE ALLOWLIST, and saying so is the honest part.
  //
  // Supabase short-circuits on an unknown account BEFORE it validates redirect_to -- the very
  // property that lets the probe run without mailing a stranger. So every line above reads "allowed"
  // whether the origin is listed or not. The first run of this file proved it: with the allowlist
  // completely EMPTY, all eight came back "allowed" and so did https://evil.example.com.
  console.log("");
  line("INCONCLUSIVE", "the eight results above",
    "an unknown account skips redirect validation — these are not evidence");

  // ⚠ AND NEITHER CAN A REAL ACCOUNT, BECAUSE SUPABASE NEVER REFUSES A redirect_to.
  //
  // I built a control here that asked for https://evil.example.com with a REAL account, expecting a
  // refusal to prove enforcement without sending. It did not refuse. It accepted the request, sent the
  // mail, and SILENTLY SUBSTITUTED Site URL in the link -- which is exactly what the first live reset
  // had already shown: redirect_to was practice.competenhealthcare.com and the link landed on
  // localhost:3000. The evidence was in front of me and I built the control on the opposite model.
  //
  // So the API surface cannot answer this at all. Supabase validates at LINK-GENERATION time and
  // reports nothing. The allowlist is observable only by sending a real message and looking at where
  // its link points -- which is why this file no longer pretends otherwise, and no longer sends a
  // message it cannot learn anything from.
  line("n/a", "allowlist via the API", "Supabase never refuses redirect_to — it substitutes Site URL");

  if (doSend) {
    console.log("");
    const origin = `https://${GATEWAYS.practice.host}`;
    const { error } = await db.auth.resetPasswordForEmail(target, { redirectTo: `${origin}/reset-password` });
    if (error) {
      line("FAILED", `reset for ${target}`, error.message.slice(0, 70));
      problems.push(`The reset request failed: ${error.message}`);
    } else {
      line("SENT", `reset for ${target}`, `redirect_to ${origin}/reset-password`);
      console.log("\n  ⚠ ACCEPTED IS NOT DELIVERED, and this one has a second question attached:");
      console.log("     1. did it arrive, and is the sender hello@competenhealthcare.com rather than Supabase's default?");
      console.log("     2. does the link land on practice.competenhealthcare.com -- the host it started on?");
      console.log("     Landing on www instead means Site URL is overriding the per-request origin.");
      console.log("     ⚠ OPEN THE LINK, RECORD THE HOST, THEN CLOSE IT. Do not set a new password --");
      console.log("        the token expires unused and your current password keeps working.");
    }
  } else {
    console.log("");
    line("not run", "reset send", "pass --send to deliver one to the address given");
  }

  console.log(`\n  ${problems.length === 0 ? "Nothing to fix." : `${problems.length} to fix:`}`);
  problems.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
  console.log("");
}

main();
