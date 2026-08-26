/**
 * MAIL AUTHENTICATION DNS CHECK — SPF, DKIM, DMARC and the inbound MX.
 *
 *   node scripts/mail-dns-check.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. Adding a sending provider to a domain that already sends mail is the step where
 * email breaks quietly. Nothing errors. Messages still leave. They just start arriving in spam, and the
 * gap between the mistake and the symptom is measured in days — by which point the obvious suspect is
 * the application, which is innocent.
 *
 * ⚠ THE MISTAKE THIS FILE EXISTS TO CATCH: A DOMAIN MAY HAVE EXACTLY ONE SPF RECORD.
 *
 * competenhealthcare.com already had one when this was written --
 * `v=spf1 a mx include:websitewelcome.com ~all`, authorising the hosting provider. The natural way to
 * add a second sender is to add a second TXT record, and that does not combine them: RFC 7208 makes two
 * SPF records a PERMERROR, which is a WORSE outcome than publishing no SPF at all. The provider's
 * `include:` has to be MERGED into the existing record instead. This script counts them, because a
 * human reading a DNS panel sees two plausible-looking lines and no warning.
 *
 * ⚠ AND IT PINS THE INBOUND MX, WHICH IS NOT A SENDING CONCERN AT ALL. The apex MX points at the
 * hosting mail server, so the domain RECEIVES mail today. A sending provider will ask for an MX on a
 * SUBDOMAIN for its return path; repointing the APEX one instead is an easy slip that silently stops
 * inbound mail — including whatever a patient replies to. The pinned value below is what was measured
 * on 2026-08-26, and a change is reported rather than assumed to be an upgrade.
 *
 * ⚠ IT CARRIES A POSITIVE AND A NEGATIVE CONTROL. `default._domainkey` exists today, so a run that
 * cannot see it is a broken lookup rather than a deleted record. And a deliberately nonexistent name
 * must report absent — a checker that says PRESENT for everything proves nothing, which is a mistake
 * this repository has made and caught before.
 *
 * This is NOT a CI harness: it needs live DNS. Run it after touching the zone.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */

import { Resolver, promises as dns } from "node:dns";

const DOMAIN = process.argv[2] || "competenhealthcare.com";

/**
 * ⚠ ASK THE AUTHORITATIVE NAMESERVERS, NOT A CACHING RESOLVER.
 *
 * This was a real defect on 2026-08-26, and it produced a WRONG ANSWER in the one situation the file
 * exists for. A DMARC record had just been added correctly; the system resolver still held the NXDOMAIN
 * it had cached minutes earlier, so this script reported MISSING and the owner was told to go looking
 * for a mistake they had not made. Negative answers are cached for the zone's SOA minimum, which means
 * a checker built to answer "did the record I just created land?" is guaranteed to be reading stale
 * data at exactly the moment it is run.
 *
 * Asking the zone's own nameservers removes the cache from the path entirely. If they cannot be
 * discovered the script falls back to the system resolver and SAYS SO in its output, because a
 * degraded run that looks identical to a good one is how the original mistake happened.
 */
async function authoritativeResolver(domain) {
  try {
    const ns = await dns.resolveNs(domain);
    const ips = (await Promise.all(ns.map(n => dns.resolve4(n).catch(() => [])))).flat();
    if (!ips.length) return { resolver: dns, authoritative: false, via: "system resolver (no NS ips)" };
    const r = new Resolver();
    r.setServers([...new Set(ips)]);
    return { resolver: r.resolveTxt ? wrapCallback(r) : dns, authoritative: true, via: ns.join(", ") };
  } catch {
    return { resolver: dns, authoritative: false, via: "system resolver (NS lookup failed)" };
  }
}

/** node:dns Resolver is callback-based; wrap the three lookups this file needs as promises. */
function wrapCallback(r) {
  const p = fn => (...args) => new Promise((res, rej) =>
    fn.call(r, ...args, (e, v) => (e ? rej(e) : res(v))));
  return { resolveTxt: p(r.resolveTxt), resolveMx: p(r.resolveMx), resolveCname: p(r.resolveCname) };
}

/** Measured 2026-08-26, before any sending provider was added. Inbound mail depends on this. */
const PINNED_MX = ["0 mail.competenhealthcare.com"];
/** Selectors worth reporting. Different selectors coexist — a new one must NOT replace the old. */
const DKIM_SELECTORS = ["default", "resend", "google", "k1", "s1"];

const problems = [];
const line = (state, label, detail = "") =>
  console.log(`  ${state.padEnd(9)} ${label.padEnd(26)} ${detail}`);

/**
 * The one rule this file exists for, as a pure function so it can be exercised without a zone that
 * is actually broken. `node scripts/mail-dns-check.mjs --self-test` fires all three branches.
 *
 * ⚠ WITHOUT THIS, THE DUPLICATE-SPF BRANCH WOULD NEVER HAVE RUN. The live zone has exactly one SPF
 * record, so the only path ever taken is the healthy one -- and a warning that has never fired is a
 * warning nobody has any reason to trust. This repository has shipped a control that could not fail
 * more than once; proving the branch is cheaper than discovering it was wrong on the day it mattered.
 */
export function classifySpf(records) {
  const spf = records.filter(r => r.toLowerCase().startsWith("v=spf1"));
  if (spf.length === 0) return { state: "MISSING", spf };
  if (spf.length > 1) return { state: "BROKEN", spf };
  return { state: "OK", spf };
}

if (process.argv.includes("--self-test")) {
  const cases = [
    { name: "no SPF at all", input: ["google-site-verification=abc"], want: "MISSING" },
    { name: "one SPF (the healthy zone)", input: ["v=spf1 a mx include:websitewelcome.com ~all"], want: "OK" },
    { name: "⚠ two SPF records — the mistake", input: [
        "v=spf1 a mx include:websitewelcome.com ~all",
        "v=spf1 include:_spf.resend.com ~all",
      ], want: "BROKEN" },
    { name: "case-insensitive match", input: ["V=SPF1 -all"], want: "OK" },
  ];
  let bad = 0;
  console.log("\nSelf-test — SPF classification\n");
  for (const c of cases) {
    const got = classifySpf(c.input).state;
    const ok = got === c.want;
    if (!ok) bad++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(34)} want=${c.want} got=${got}`);
  }
  console.log(`\n  ${cases.length - bad}/${cases.length} passed\n`);
  process.exit(bad === 0 ? 0 : 1);
}

const { resolver, authoritative, via } = await authoritativeResolver(DOMAIN);

async function txt(host) {
  try { return (await resolver.resolveTxt(host)).map(chunks => chunks.join("")); }
  catch { return null; }
}

console.log(`\nMail authentication DNS — ${DOMAIN}`);
console.log(authoritative
  ? `Asked authoritatively: ${via}  (no cache in the path)\n`
  : `⚠ ${via} — results may be CACHED. A record added in the last few minutes can read as absent.\n`);
if (!authoritative) problems.push(
  "Could not reach the authoritative nameservers, so every result above may be a cached answer. "
  + "Re-run before acting on a MISSING.");

// ── SPF ──────────────────────────────────────────────────────────────────────────────────────────
const apexTxt = (await txt(DOMAIN)) ?? [];
const { spf } = classifySpf(apexTxt);

if (spf.length === 0) {
  line("MISSING", "SPF", "no v=spf1 record at the apex");
  problems.push("SPF is absent. Mail from this domain has no sender authorisation.");
} else if (spf.length > 1) {
  line("BROKEN", "SPF", `${spf.length} records — this is a PERMERROR`);
  spf.forEach(r => line("", "", `  ${r}`));
  problems.push(
    "TWO OR MORE SPF RECORDS. This fails authentication entirely and is worse than having none. "
    + "Merge them into ONE record carrying every include:, then delete the extras.");
} else {
  const includes = [...spf[0].matchAll(/include:([^\s]+)/g)].map(m => m[1]);
  const all = spf[0].match(/[~\-+?]all/)?.[0] ?? "(no all mechanism)";
  line("OK", "SPF", `1 record · ${all}`);
  line("", "", `  ${spf[0]}`);
  line("", "  senders authorised", includes.length ? includes.join(", ") : "(none via include:)");
  if (!includes.some(i => /resend/i.test(i))) {
    line("", "  note", "no resend include yet — expected until the provider is added");
  }
}

// ── DKIM ─────────────────────────────────────────────────────────────────────────────────────────
console.log("");
let dkimFound = 0;
for (const sel of DKIM_SELECTORS) {
  const rec = await txt(`${sel}._domainkey.${DOMAIN}`);
  // ⚠ v= IS OPTIONAL IN A DKIM RECORD, and requiring it reported a PRESENT, VALID key as absent.
  // Resend publishes the bare public key -- "p=MIGfMA...QIDAQAB" with no v=DKIM1 prefix -- and this
  // check demanded the prefix, so it called a correctly-configured domain unverified. RFC 6376 makes
  // v= optional (only its POSITION is fixed when present). The public key is what makes it a key.
  // ⚠ v= IS OPTIONAL IN A DKIM RECORD (RFC 6376 fixes only its POSITION when present). Requiring it
  // reported a PRESENT, VALID Resend key -- published as a bare "p=..." -- as absent.
  const isKey = rec?.some(r => /(^|;)s*p=[A-Za-z0-9+/=]{40,}/.test(r) || /v=DKIM1/i.test(r));
  // ⚠ PRESENT-BUT-UNUSABLE IS NOT ABSENT, and calling it absent sends somebody to add a record that
  // is already there. A DKIM value carrying a stub key -- a truncated paste, a placeholder, a cell
  // copied with its surrounding prose -- resolves fine and signs nothing.
  if (isKey) { dkimFound++; line("OK", `DKIM ${sel}`, "key published"); }
  else if (rec?.length) {
    const shown = rec.join(" ").slice(0, 46);
    line("INVALID", `DKIM ${sel}`, `record exists but carries no usable key: "${shown}"`);
    problems.push(`DKIM ${sel} exists but its value is not a key. Re-copy it from the provider.`);
  }
  else line("absent", `DKIM ${sel}`, "");
}
if (dkimFound === 0) problems.push("No DKIM key found under any known selector.");

// ── RESEND SENDING SUBDOMAIN ─────────────────────────────────────────────────────────────────────
// ⚠ RESEND SCOPES ITS SPF AND RETURN-PATH MX TO A SUBDOMAIN (`send.<domain>`), not the apex. That is
// why the apex SPF needed no merge and the inbound MX needed no change -- the conflict this file was
// built to catch does not arise in this layout. Checked explicitly so "no conflict" is a measurement
// rather than an assumption, and so a record added to the WRONG level is visible.
console.log("");
const sendHost = `send.${DOMAIN}`;
const sendTxt = (await txt(sendHost)) ?? [];
const sendSpf = sendTxt.filter(r => r.toLowerCase().startsWith("v=spf1"));
if (sendSpf.length === 1) {
  // ⚠ "v=spf1 ... ~all" WITH NOTHING IN THE MIDDLE AUTHORISES NOBODY, and reporting it OK is how a
  // mangled paste survives review. An SPF record needs at least one mechanism that grants a sender:
  // include:, ip4:, ip6:, a or mx. Without one it parses, resolves, and permits nothing.
  const grants = /(include:|ip4:|ip6:)|(^|s)(a|mx)(s|$)/.test(sendSpf[0].replace(/^v=spf1/, ""));
  if (grants) line("OK", "send. SPF", sendSpf[0].slice(0, 60));
  else {
    line("INVALID", "send. SPF", `authorises nothing: "${sendSpf[0].slice(0, 40)}"`);
    problems.push("The send. SPF has no include:/ip4:/a/mx mechanism, so it authorises no sender. Re-copy it from the provider.");
  }
}
else if (sendSpf.length === 0) line("absent", "send. SPF", "Resend sending not enabled yet");
else { line("BROKEN", "send. SPF", `${sendSpf.length} records`); problems.push("More than one SPF on the send subdomain."); }

let sendMx = [];
try { sendMx = (await resolver.resolveMx(sendHost)).map(m => `${m.priority} ${m.exchange}`); } catch { /* none */ }
line(sendMx.length ? "OK" : "absent", "send. MX (return path)", sendMx.join(", ") || "Resend bounce handling not set up");

// ⚠ THE APEX MUST NOT HAVE ACQUIRED RESEND RECORDS. Putting them at the apex instead of on send. is
// the mistake this layout makes possible: it would collide with the existing SPF and, for MX, cut off
// inbound mail entirely.
const apexHasResend = spf.some(r => /resend|amazonses/i.test(r));
line(apexHasResend ? "WRONG" : "OK", "apex kept clean", apexHasResend ? "a Resend SPF landed on the APEX" : "no Resend records at apex, as intended");
if (apexHasResend) problems.push(
  "A Resend SPF include is on the APEX. This layout puts it on send. -- at the apex it collides with "
  + "the existing hosting SPF, and only one SPF record per name is valid.");

// ── DMARC ────────────────────────────────────────────────────────────────────────────────────────
console.log("");
const dmarc = (await txt(`_dmarc.${DOMAIN}`))?.filter(r => /^v=DMARC1/i.test(r)) ?? [];
if (dmarc.length === 0) {
  line("MISSING", "DMARC", "no _dmarc record");
  problems.push(
    "DMARC is absent. Gmail and Yahoo require it from bulk senders. "
    + "Start with: v=DMARC1; p=none; rua=mailto:<you>@" + DOMAIN);
} else if (dmarc.length > 1) {
  line("BROKEN", "DMARC", `${dmarc.length} records — only one is permitted`);
  problems.push("More than one DMARC record. Remove all but one.");
} else {
  const policy = dmarc[0].match(/p=(\w+)/)?.[1] ?? "(unset)";
  line("OK", "DMARC", `p=${policy}`);
  line("", "", `  ${dmarc[0]}`);
  if (policy === "none") line("", "  note", "monitor mode — tighten to quarantine once alignment is clean");
}

// ── Inbound MX ───────────────────────────────────────────────────────────────────────────────────
console.log("");
let mx = [];
try { mx = (await resolver.resolveMx(DOMAIN)).map(m => `${m.priority} ${m.exchange}`).sort(); } catch { /* none */ }
if (mx.length === 0) {
  line("MISSING", "MX (inbound)", "the domain cannot receive mail");
  problems.push("No MX record. Anything sent to an address at this domain will bounce.");
} else if (JSON.stringify(mx) !== JSON.stringify([...PINNED_MX].sort())) {
  line("CHANGED", "MX (inbound)", mx.join(", "));
  line("", "  was", PINNED_MX.join(", "));
  problems.push(
    "THE APEX MX CHANGED. If a sending provider asked for an MX, it belongs on a SUBDOMAIN for its "
    + "return path — repointing the apex stops inbound mail to every address at this domain.");
} else {
  line("OK", "MX (inbound)", mx.join(", "));
}

// ── Controls ─────────────────────────────────────────────────────────────────────────────────────
console.log("");
const posControl = await txt(`default._domainkey.${DOMAIN}`);
const negControl = await txt(`no-such-record-9f3a.${DOMAIN}`);
const posOk = posControl !== null;
const negOk = negControl === null;
line(posOk ? "OK" : "BROKEN", "control (known record)", posOk ? "resolver sees a record that exists" : "cannot see a record that DOES exist — the lookup is broken, not the zone");
line(negOk ? "OK" : "BROKEN", "control (absent record)", negOk ? "reports absence correctly" : "claims a nonexistent record exists — do not trust this run");
if (!posOk || !negOk) problems.push("A CONTROL FAILED. Treat every result above as unreliable.");

// ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
console.log("");
if (problems.length === 0) {
  console.log("  Nothing to fix.\n");
} else {
  console.log(`  ${problems.length} thing${problems.length > 1 ? "s" : ""} to fix:\n`);
  problems.forEach((p, i) => console.log(`   ${i + 1}. ${p}\n`));
}
process.exit(problems.length === 0 ? 0 : 1);
