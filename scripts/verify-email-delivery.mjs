// Proves email delivery end to end, BOTH senders, against a real inbox -- the one thing CPR-GATE-001
// says it assumes and never checked: "Verification and reset emails ride the platform's identity
// configuration; this document assumes it already works."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THERE ARE TWO EMAIL SENDERS AND THEY ARE CONFIGURED IN DIFFERENT PLACES. A pilot breaks if either is
// missing, and a green check on one says nothing about the other:
//
//   APP-SENT      invitation codes, appointment confirmations, OTPs. src/lib/practice/messaging.ts
//                 calls Resend directly. Configured by RESEND_API_KEY + RESEND_FROM in .env.local.
//                 This script can test it fully.
//
//   SUPABASE-SENT password reset, email verification, magic links. Supabase Auth sends these from ITS
//                 configuration -- Dashboard > Authentication > SMTP Settings -- which is not in this
//                 repository and cannot be set from here. This script can only TRIGGER one and tell you
//                 to look in the inbox.
//
// Both legs send to an address YOU supply. Nothing here sends to a patient, a practitioner, or anyone
// who did not run the command.
//
//   node scripts/verify-email-delivery.mjs you@yourdomain.com
// ────────────────────────────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = { ...process.env };
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const to = process.argv[2];
if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error("\nusage: node scripts/verify-email-delivery.mjs <your-real-inbox@domain>\n");
  process.exit(1);
}

let bad = 0;
const ok = (s) => console.log(`  OK    ${s}`);
const fail = (s, why) => { bad++; console.log(`  FAIL  ${s}\n        ${why}`); };
const todo = (s) => console.log(`  YOU   ${s}`);

console.log(`\nEMAIL DELIVERY  ->  ${to}\n`);

// ── LEG 1: app-sent, via Resend ─────────────────────────────────────────────────────────────────
console.log("LEG 1 -- app-sent email (Resend)");
const from = env.NOTIFY_FROM_EMAIL ?? env.RESEND_FROM ?? null;
if (!env.RESEND_API_KEY) fail("RESEND_API_KEY is set", "not set -- add it to .env.local (Resend dashboard > API Keys)");
else if (!from) fail("a from-address is set", "RESEND_API_KEY is present but neither RESEND_FROM nor NOTIFY_FROM_EMAIL is -- a key with no sender is NOT a configured provider, and the engine refuses rather than sending from an invalid domain");
else {
  ok(`configured: from ${from}`);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from, to: [to],
      subject: "Competen email check (leg 1: app-sent via Resend)",
      text: `This is the app-sent leg. If you are reading it, Resend accepted ${from} as a sender and delivered to ${to}.\n\nSent by scripts/verify-email-delivery.mjs at ${new Date().toISOString()}.`,
    }),
  });
  const body = await r.text();
  if (r.ok) { ok(`Resend accepted the message (id ${JSON.parse(body)?.id ?? "?"})`); todo(`check ${to} for "leg 1" -- accepted is not delivered`); }
  else fail("Resend accepted the message", `HTTP ${r.status}: ${body.slice(0, 300)}\n        A 403 here almost always means ${from.split("@")[1]} is not a VERIFIED domain in Resend. Resend only sends from domains you have proven you own.`);
}

// ── LEG 2: Supabase-sent, the password reset ────────────────────────────────────────────────────
console.log("\nLEG 2 -- Supabase Auth email (password reset)");
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) fail("Supabase configured", "NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing");
else {
  // The ANON client, exactly as the forgot-password page uses it. The service role would bypass the
  // rate limit and the redirect allow-list, proving less.
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const site = env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error } = await sb.auth.resetPasswordForEmail(to, { redirectTo: `${site}/reset-password` });
  if (error) fail("Supabase accepted the reset request", error.message);
  else {
    ok("Supabase accepted the reset request");
    console.log(`        Supabase returns success whether or not ${to} has an account (it must -- otherwise`);
    console.log(`        this endpoint would reveal who has one). So acceptance proves NOTHING about delivery.`);
    todo(`check ${to} for the reset email. If it is absent after two minutes, the cause is one of:`);
    console.log(`          - no account exists for ${to}  (Supabase silently sends nothing)`);
    console.log(`          - Supabase is on its built-in sender: 2 emails/hour, often spam-foldered, NOT for a pilot`);
    console.log(`          - custom SMTP is set but the sender domain is unverified at the SMTP provider`);
  }
}

// ── THE GAP THIS SCRIPT CANNOT CLOSE ────────────────────────────────────────────────────────────
console.log(`
WHAT THIS CANNOT CHECK, AND WHY IT MATTERS FOR THE PILOT
  Supabase's sender lives in Dashboard > Authentication > SMTP Settings, outside this repo. On the
  default sender it is rate-limited to a handful per hour and lands in spam -- fine for you testing,
  fatal for a practitioner locked out on a Monday. To put Resend behind it:
    Host smtp.resend.com   Port 465   User "resend"   Password <a Resend API key>
    Sender: an address on a domain VERIFIED in Resend (the same one leg 1 uses)
  Then re-run this and confirm leg 2 arrives FROM that address.
`);
process.exit(bad ? 1 : 0);
