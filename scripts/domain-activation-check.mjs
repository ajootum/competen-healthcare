/**
 * COMP-ACCESS-URL-001 s9/s12 -- DNS AND TLS ACTIVATION CHECK.
 *
 *   node scripts/domain-activation-check.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR. s9 is the one part of COMP-ACCESS-URL-001 that no code can perform: DNS records
 * are created at the registrar's DNS provider by the owner. This script is the other half -- it says,
 * for each canonical hostname, whether the record exists, whether TLS terminates, and what the origin
 * actually answers. Run it after creating the records; run it again after any change.
 *
 * ⚠ IT REPORTS FOUR DISTINCT STATES AND DOES NOT COLLAPSE THEM, because they have different fixes:
 *
 *   NO DNS          the name does not resolve at all -- the record is missing, or has not propagated
 *   DNS, NO TLS     the name resolves but the handshake fails -- usually Vercel has not issued the
 *                   certificate yet, which it does automatically within minutes of DNS being correct
 *   WRONG TARGET    it resolves somewhere that is not this deployment -- a typo, or an old record
 *   LIVE            resolves, TLS valid, and the origin answers
 *
 * "Not working" is not a diagnosis. A missing record and a pending certificate look identical in a
 * browser and are half an hour apart in what you should do about them.
 *
 * ⚠ AND IT SAYS NOTHING ABOUT WHETHER THE GATEWAY BEHAVES CORRECTLY. A hostname that returns 200 is
 * serving the application; whether it lands on the right product surface is s5/s6/s7, which is
 * application behaviour and is checked by the acceptance harnesses, not by DNS. Five of the six
 * subdomains have no gateway routing built yet -- only `staff` does (COMP-HQ-ACCESS-001 s5). A green
 * line here means the address works, not that the product behind it is wired.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */

import { Resolver, promises as dns } from "node:dns";
import { connect } from "node:tls";

/**
 * ⚠ ASK THE AUTHORITATIVE NAMESERVERS FOR THE RECORD, NOT A CACHING RESOLVER.
 *
 * Fixed 2026-08-26 after the sibling script (mail-dns-check.mjs) got this wrong and gave a WRONG
 * ANSWER in the exact situation it exists for: a DMARC record had just been added correctly, the
 * system resolver still held the NXDOMAIN it cached minutes earlier, and the owner was sent looking
 * for a mistake they had not made. Negative answers are cached for the zone's SOA minimum, so a
 * checker built to answer "did the record I just created land?" is reading stale data precisely when
 * it is run.
 *
 * ⚠ THIS SPLITS ONE OLD STATE INTO TWO, and the distinction is the useful part. TLS and HTTP still go
 * through the SYSTEM resolver, because that is what a browser would do. So a record can be correct in
 * the zone while the local resolver has not caught up — which is not the same problem as a record that
 * was never created, and has a different answer: wait, rather than go back to the DNS panel.
 */
async function authoritativeResolver(domain) {
  try {
    const ns = await dns.resolveNs(domain);
    const ips = (await Promise.all(ns.map(n => dns.resolve4(n).catch(() => [])))).flat();
    if (!ips.length) return { auth: null, via: "system resolver (no NS ips)" };
    const r = new Resolver();
    r.setServers([...new Set(ips)]);
    const p = fn => (...a) => new Promise((res, rej) => fn.call(r, ...a, (e, v) => (e ? rej(e) : res(v))));
    return { auth: { resolveCname: p(r.resolveCname), resolve4: p(r.resolve4) }, via: ns.join(", ") };
  } catch {
    return { auth: null, via: "system resolver (NS lookup failed)" };
  }
}

const DOMAIN = "competenhealthcare.com";
/** The six canonical product gateways (s1), plus the two that already work, as a control. */
const SUBS = ["practice", "enterprise", "individual", "recruitment", "staff", "platform"];
const CONTROLS = ["www"];
/** What Vercel requires these to CNAME to. From `vercel domains verify`, 2026-08-24. */
const EXPECTED_CNAME = "fe965000d36362fc.vercel-dns-017.com";

const { auth, via } = await authoritativeResolver(DOMAIN);

/** What the ZONE says. Cache-free when the authoritative servers are reachable. */
async function resolveHost(host) {
  const r = auth ?? dns;
  const out = { cname: null, addresses: [] };
  try { out.cname = (await r.resolveCname(host))[0] ?? null; } catch { /* not a CNAME, or absent */ }
  try { out.addresses = (await r.resolve4(host)); } catch { /* absent */ }
  return out;
}

/** What a BROWSER would see. Goes through the system resolver on purpose. */
async function resolvedLocally(host) {
  try { await dns.lookup(host); return true; } catch { return false; }
}

function tlsCheck(host) {
  return new Promise(resolve => {
    const socket = connect({ host, port: 443, servername: host, timeout: 12000 }, () => {
      const cert = socket.getPeerCertificate();
      resolve({
        ok: socket.authorized,
        error: socket.authorized ? null : socket.authorizationError,
        subject: cert?.subject?.CN ?? null,
        altNames: cert?.subjectaltname ?? null,
        validTo: cert?.valid_to ?? null,
      });
      socket.end();
    });
    socket.on("timeout", () => { socket.destroy(); resolve({ ok: false, error: "timeout" }); });
    socket.on("error", e => resolve({ ok: false, error: e.code || e.message }));
  });
}

async function httpCheck(host) {
  try {
    const res = await fetch(`https://${host}/`, { redirect: "manual", signal: AbortSignal.timeout(20000) });
    return { status: res.status, location: res.headers.get("location") };
  } catch (e) { return { status: null, error: e.cause?.code || e.message }; }
}

async function assess(host, isControl) {
  const rec = await resolveHost(host);
  const resolved = rec.addresses.length > 0 || rec.cname !== null;
  if (!resolved) return { host, state: "NO DNS", detail: "no A and no CNAME record", isControl };

  const target = rec.cname ? rec.cname.replace(/\.$/, "") : null;
  const where = target ? `CNAME -> ${target}` : `A -> ${rec.addresses.join(", ")}`;

  // ⚠ THE ZONE HAS IT, THIS MACHINE DOES NOT YET. A different problem from a missing record, and the
  // answer is to wait rather than to go back to the DNS panel. Splitting these two apart is the whole
  // reason this script asks the authoritative servers separately from how it connects.
  if (auth && !(await resolvedLocally(host))) {
    return { host, isControl, state: "PROPAGATING", detail: `${where}; correct in the zone, not yet visible to this resolver` };
  }

  const tls = await tlsCheck(host);
  if (!tls.ok) {
    return {
      host, isControl,
      state: "DNS, NO TLS",
      detail: `${where}; TLS: ${tls.error}`,
    };
  }

  const http = await httpCheck(host);
  // A control (www) legitimately uses a different, older target. Only the six are held to EXPECTED_CNAME.
  const targetOk = isControl || target === null || target === EXPECTED_CNAME;
  return {
    host, isControl,
    state: targetOk ? "LIVE" : "WRONG TARGET",
    detail: `${target ? `CNAME -> ${target}` : `A -> ${rec.addresses.join(", ")}`}`
      + `; TLS ok (expires ${tls.validTo})`
      + `; HTTP ${http.status ?? http.error}${http.location ? ` -> ${http.location}` : ""}`,
  };
}

const rows = [];
for (const s of [...SUBS, ...CONTROLS]) {
  rows.push(await assess(`${s}.${DOMAIN}`, CONTROLS.includes(s)));
}
rows.push(await assess(DOMAIN, true));

console.log(`\nCOMP-ACCESS-URL-001 s9 -- domain activation\nExpected CNAME target: ${EXPECTED_CNAME}\n`);
const pad = Math.max(...rows.map(r => r.host.length));
for (const r of rows) {
  const mark = r.state === "LIVE" ? "OK  " : "    ";
  console.log(`  ${mark}${r.host.padEnd(pad)}  ${r.state.padEnd(12)}  ${r.detail}${r.isControl ? "   (control)" : ""}`);
}

const gateways = rows.filter(r => !r.isControl);
const live = gateways.filter(r => r.state === "LIVE").length;
console.log(`\n  ${live}/${gateways.length} canonical gateways live.`);
if (live < gateways.length) {
  console.log(`  Not yet activated: ${gateways.filter(r => r.state !== "LIVE").map(r => r.host.split(".")[0]).join(", ")}`);
  console.log(`  A record that resolves but shows "DNS, NO TLS" usually just needs a few minutes --`);
  console.log(`  Vercel issues the certificate once it sees correct DNS.\n`);
} else {
  console.log(`  s12 "Canonical hosts" passes at the DNS/TLS level. Gateway BEHAVIOUR is separate.\n`);
}
process.exit(live === gateways.length ? 0 : 1);
