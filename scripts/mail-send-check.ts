/**
 * PRODUCTION EMAIL ACCEPTANCE — is the app stack actually able to send?
 *
 *   npx tsx scripts/mail-send-check.ts                  # configuration only, sends nothing
 *   npx tsx scripts/mail-send-check.ts --send you@your.address
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THERE ARE TWO EMAIL SYSTEMS AND THIS FILE CHECKS ONE OF THEM.
 *
 *   APPLICATION MAIL  notifications, practice messaging, patient booking codes. Sent by this codebase
 *                     with fetch -> api.resend.com. Configured by RESEND_API_KEY plus a sender
 *                     (NOTIFY_FROM_EMAIL or RESEND_FROM). ← this file
 *
 *   SUPABASE AUTH MAIL  signup confirmation, invitations, password resets. Sent by Supabase's own
 *                     mailer, configured in the Supabase dashboard's SMTP settings. NOTHING in this
 *                     repository can read or verify it -- project config needs a management token, and
 *                     the service-role key gets 401.
 *
 * Setting RESEND_API_KEY fixes the first and does NOT fix the second. They fail identically from a
 * browser -- "no email arrived" -- and have completely different causes, so the distinction is stated
 * here rather than left for somebody to rediscover at the moment a practitioner is waiting for a code.
 *
 * ⚠ IT DOES NOT SEND UNLESS TOLD TO. A checker that silently mails somebody every time it runs is a
 * checker nobody runs. `--send` takes the recipient explicitly, so the address is a decision.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */

import { createRequire } from "node:module";
const require2 = createRequire(process.cwd() + "/");
const { loadEnvConfig } = require2("@next/env");
loadEnvConfig(process.cwd());

import { messagingStatus } from "../src/lib/practice/messaging";
import { channelProviders, emailFrom, replyTo } from "../src/lib/notifications/dispatch";

const line = (state: string, label: string, detail = "") =>
  console.log(`  ${state.padEnd(11)} ${label.padEnd(34)} ${detail}`);

const problems: string[] = [];
const sendTo = (() => {
  const i = process.argv.indexOf("--send");
  return i >= 0 ? process.argv[i + 1] ?? null : null;
})();

console.log("\nProduction email — application stack\n");

// ── 1. Is a key present at all? ──────────────────────────────────────────────────────────────────
const key = process.env.RESEND_API_KEY ?? null;
line(key ? "OK" : "MISSING", "RESEND_API_KEY", key ? `present (${key.slice(0, 3)}…, ${key.length} chars)` : "no key in this environment");
if (!key) problems.push("RESEND_API_KEY is absent. The application cannot send any mail.");

// ── 2. A key without a sender is not a configured provider ───────────────────────────────────────
const from = emailFrom();
line(from ? "OK" : "MISSING", "sender address", from ?? "neither NOTIFY_FROM_EMAIL nor RESEND_FROM is set");
if (!from) problems.push(
  "No sender address. Both stacks require a key AND a from-address -- a deployment with only a key "
  + "once reported 'configured' and then sent from an invalid domain, which Resend rejects.");

// ⚠ THE SENDER MUST BE ON THE VERIFIED DOMAIN. Resend rejects anything else, and the rejection reads
// like an outage rather than a wrong setting.
if (from) {
  const domain = from.includes("@") ? from.split("@").pop()!.replace(/>.*$/, "").trim() : "";
  const onDomain = /(^|\.)competenhealthcare\.com$/.test(domain);
  line(onDomain ? "OK" : "WRONG", "sender domain", domain || "(unparseable)");
  if (!onDomain) problems.push(
    `The sender is on "${domain}", not competenhealthcare.com. Resend will reject it unless that domain `
    + "is also verified in the same account.");
  if (/^no-?reply@/i.test(from)) {
    line("NOTE", "no-reply sender", "replies are discarded — see below");
    problems.push(
      "The sender is a no-reply address AND neither send path sets reply_to, so a patient replying to a "
      + "booking confirmation reaches nobody. Either use a monitored address or add reply_to support.");
  }
}

// ── 2b. Reply handling ───────────────────────────────────────────────────────────────────────────
const reply = replyTo();
line(reply ? "OK" : "NONE", "reply-to", reply ?? "unset — replies go to the from-address");
if (!reply && from && /^no-?reply@/i.test(from)) problems.push(
  "A no-reply sender with no NOTIFY_REPLY_TO. A patient answering a booking confirmation reaches nobody.");

// ── 3. What the product itself believes ──────────────────────────────────────────────────────────
const ms = messagingStatus();
const cp = channelProviders();
line(ms.email.configured ? "OK" : "not ready", "practice messaging stack", ms.email.provider ?? "no provider");
line(cp.email.ready ? "OK" : "not ready", "platform notification stack", cp.email.provider ?? "no provider");
// ⚠ BOTH OR NEITHER. They read different variable names historically; each now accepts either, so a
// split result means one of them regressed rather than a deployment being half-configured.
if (ms.email.configured !== cp.email.ready) problems.push(
  "The two stacks DISAGREE about whether email is configured. They accept the same variables now, so "
  + "this means one of the resolvers has drifted -- not a deployment problem.");

// ── 4. Optional: actually send one ───────────────────────────────────────────────────────────────
async function main() {
if (sendTo) {
  if (!key || !from) {
    line("SKIPPED", "test send", "not configured — nothing to test");
  } else {
    console.log("");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from, to: [sendTo],
        subject: "Competen — production email acceptance",
        text: "This message was sent by scripts/mail-send-check.ts to prove the application stack can "
            + "deliver from competenhealthcare.com.\n\nIt says nothing about Supabase Auth mail "
            + "(confirmations, invitations, password resets), which is configured separately in the "
            + "Supabase dashboard's SMTP settings.\n\nIf you can reply to this and the reply arrives, "
            + "reply handling works too.",
      }),
    });
    const body = await res.text();
    if (res.ok) {
      line("SENT", "test send", `to ${sendTo} — id ${(JSON.parse(body).id ?? "?")}`);
      console.log("\n  ⚠ ACCEPTED IS NOT DELIVERED. Resend has taken it; whether it lands in an inbox");
      console.log("     rather than spam depends on SPF, DKIM and DMARC. Confirm it arrived, and reply");
      console.log("     to it to test the reply path.");
    } else {
      line("REJECTED", "test send", `HTTP ${res.status}`);
      console.log(`     ${body.slice(0, 300)}`);
      problems.push(`Resend rejected the send with HTTP ${res.status}. The message above names the reason.`);
    }
  }
} else {
  console.log("");
  line("not run", "test send", "pass --send <address> to prove delivery end to end");
}

} // end main
main().then(() => {
// ── 5. What this file cannot answer ──────────────────────────────────────────────────────────────
console.log("\n  Not checked here, and not claimed:");
console.log("    Supabase Auth mail — confirmations, invitations, password resets. Configured in the");
console.log("    Supabase dashboard (SMTP settings) and unreadable from this repository. A green run");
console.log("    above does NOT mean a password-reset email will arrive.");

console.log(`\n  ${problems.length === 0 ? "Application stack: nothing to fix." : `${problems.length} to fix:`}`);
problems.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
console.log("");
// ⚠ SET THE CODE, DO NOT CALL process.exit(). Exiting from inside a promise chain tears the event
// loop down while stdout may still be flushing, and on Windows that surfaced as a libuv assertion
// printed AFTER the report -- "!(handle->flags & UV_HANDLE_CLOSING)". Harmless, and exactly the kind
// of noise that trains somebody to ignore the end of a tool's output. Setting exitCode lets node
// finish writing and then exit with the same status.
process.exitCode = problems.length === 0 ? 0 : 1;
});
