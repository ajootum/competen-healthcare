/**
 * COMP-ACCESS-URL-001 §12 — GATEWAY ACCEPTANCE, against the live hosts.
 *
 *   node scripts/gateway-acceptance-check.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * Six hostnames went live on 2026-08-26. Six new front doors to a healthcare application is six new
 * pieces of attack surface, and the spec's own acceptance table asks the two questions that matter
 * before anything else:
 *
 *   "Privileged boundaries — ordinary product identity cannot gain HQ/platform access by hostname
 *    manipulation"
 *   "Isolation — host manipulation cannot bypass tenant/Practice/product authorization"
 *
 * Both are answerable WITHOUT signing in, which is what makes them worth automating: the answer must be
 * that arriving on `platform.` or `staff.` buys exactly nothing that arriving on `www.` does not. §5
 * states the principle — the gateway determines context and branding, never authorization — and this
 * file is the demonstration of it. It asserts the responses are IDENTICAL ACROSS HOSTS, not merely that
 * each one is individually a redirect: a host that refused differently would still "pass" a per-host
 * check while proving the principle false.
 *
 * ⚠ CONNECTS BY IP WITH SNI, the way `curl --resolve` does. While records are propagating the local
 * resolver may not see a host that is already live at the edge, and a checker that reported failure in
 * that window would be measuring this machine rather than production. The edge IP is derived from the
 * zone's own CNAME target, resolved authoritatively.
 *
 * ⚠ WHAT THIS CANNOT PROVE, and does not claim: §6 and §7 authenticated behaviour — that one entitled
 * destination lands directly, several render the chooser, and none renders the controlled no-product
 * state. Those need a real signed-in identity. `resolveProductDestinations` is unit-covered by
 * access-doors-harness; the live authenticated pass is the owner's, and this file says so rather than
 * quietly reporting green over an untested half.
 *
 * Not a CI harness: needs live DNS and network.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */

import { Resolver, promises as dns } from "node:dns";
import { request } from "node:https";

const DOMAIN = "competenhealthcare.com";
const GATEWAYS = ["practice", "enterprise", "individual", "recruitment", "staff", "platform"];

const problems = [];
const ok = (cond, label, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) problems.push(label);
};

/** Resolve authoritatively so a propagating record is not mistaken for a missing one. */
async function edgeIp() {
  const ns = await dns.resolveNs(DOMAIN);
  const ips = (await Promise.all(ns.map(n => dns.resolve4(n).catch(() => [])))).flat();
  const r = new Resolver();
  if (ips.length) r.setServers([...new Set(ips)]);
  const cname = await new Promise((res, rej) =>
    r.resolveCname(`${GATEWAYS[0]}.${DOMAIN}`, (e, v) => (e ? rej(e) : res(v[0]))));
  const [ip] = await dns.resolve4(cname.replace(/\.$/, ""));
  return { ip, cname: cname.replace(/\.$/, "") };
}

/** One request, connected to `ip` but presenting `host` for SNI and Host — i.e. curl --resolve. */
function fetchVia(ip, host, path) {
  return new Promise(resolve => {
    const req = request(
      { host: ip, servername: host, headers: { Host: host }, path, method: "GET", timeout: 25000 },
      res => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location ?? null });
      });
    req.on("timeout", () => { req.destroy(); resolve({ status: null, error: "timeout" }); });
    req.on("error", e => resolve({ status: null, error: e.code || e.message }));
    req.end();
  });
}

const { ip, cname } = await edgeIp();
console.log(`\nCOMP-ACCESS-URL-001 §12 — gateway acceptance`);
console.log(`Edge ${cname} -> ${ip}; connecting by IP with SNI so propagation cannot skew the result\n`);

// ── The gateways answer at all ───────────────────────────────────────────────────────────────────
console.log("Reachability");
const roots = {};
for (const g of GATEWAYS) {
  const host = `${g}.${DOMAIN}`;
  roots[g] = await fetchVia(ip, host, "/");
  ok(roots[g].status === 200, `${host} serves over TLS`, `HTTP ${roots[g].status ?? roots[g].error}`);
}

// ── §5 / §12 privileged boundaries ───────────────────────────────────────────────────────────────
console.log("\n⚠ Privileged boundaries — a hostname must not buy landlord access");
const admin = {};
for (const g of GATEWAYS) {
  const host = `${g}.${DOMAIN}`;
  const r = await fetchVia(ip, host, "/super-admin");
  admin[g] = r;
  const refused = r.status === 307 && (r.location || "").includes("/login");
  ok(refused, `${host}/super-admin is refused`, `HTTP ${r.status} -> ${r.location ?? "(none)"}`);
}
// ⚠ The property, not the per-host result. A host that refused DIFFERENTLY would pass every check
// above while proving §5 false, so the shape of the refusal is compared across all six.
const adminShapes = new Set(GATEWAYS.map(g => {
  const l = admin[g].location ?? "";
  return `${admin[g].status}|${l.replace(`${g}.${DOMAIN}`, "<host>")}`;
}));
ok(adminShapes.size === 1,
  "⚠ every gateway refuses IDENTICALLY — authorization is host-independent (§5)",
  [...adminShapes].join("  ·  "));

// ── §12 isolation ────────────────────────────────────────────────────────────────────────────────
console.log("\n⚠ Isolation — a hostname must not bypass tenant authorization");
const tenant = {};
for (const g of GATEWAYS) {
  const host = `${g}.${DOMAIN}`;
  const r = await fetchVia(ip, host, "/practice/home");
  tenant[g] = r;
  const refused = r.status === 307 && (r.location || "").includes("sign-in");
  ok(refused, `${host}/practice/home is refused`, `HTTP ${r.status}`);
}
const tenantShapes = new Set(GATEWAYS.map(g => {
  const l = tenant[g].location ?? "";
  return `${tenant[g].status}|${l.replace(`${g}.${DOMAIN}`, "<host>")}`;
}));
ok(tenantShapes.size === 1,
  "⚠ every gateway refuses a tenant route IDENTICALLY",
  [...tenantShapes].join("  ·  "));

// ── COMP-HQ-ACCESS-001 §5 — the one gateway with real host behaviour ─────────────────────────────
console.log("\nStaff host rewrite (the only gateway with host-aware routing today)");
const staffRoot = await fetchVia(ip, `staff.${DOMAIN}`, "/");
const wwwStaff  = await fetchVia(ip, `www.${DOMAIN}`, "/staff");
const wwwRoot   = await fetchVia(ip, `www.${DOMAIN}`, "/");
ok(staffRoot.status === 200 && wwwStaff.status === 200,
  "the staff host's root and www/staff both answer", `${staffRoot.status} / ${wwwStaff.status}`);
ok(wwwRoot.status === 200,
  "⚠ fail-open: the customer host's root is untouched", `HTTP ${wwwRoot.status}`);
const deep = await fetchVia(ip, `staff.${DOMAIN}`, "/login");
ok(deep.status === 200,
  "⚠ ONLY the root is rewritten — /login on the staff host resolves normally", `HTTP ${deep.status}`);

// ── What is NOT covered ──────────────────────────────────────────────────────────────────────────
console.log("\nNot covered here, and not claimed");
console.log("  §6/§7 authenticated routing — one destination lands, several choose, none refuses.");
console.log("  Needs a signed-in identity. Unit-covered by access-doors-harness; the live pass is the owner's.");
console.log("  §13 step 5 — five of six gateways serve the marketing root because host-aware product");
console.log("  context is not built yet. That is the spec's sequence, not a defect.");

console.log(`\n  ${problems.length === 0 ? "All acceptance rows checked here pass." : `${problems.length} failing:`}`);
problems.forEach(p => console.log(`   - ${p}`));
console.log("");
process.exit(problems.length === 0 ? 0 : 1);
