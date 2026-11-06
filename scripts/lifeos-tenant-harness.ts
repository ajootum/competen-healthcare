/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LIFEOS-API-001 delivery step 7: a tenant's domains and branding, over real HTTP and in a real browser on a real hostname.
 *
 *   LIFEOS_BASE_URL=http://localhost:3117 npx tsx scripts/lifeos-tenant-harness.ts
 *
 * Needs the dev server started with LIFEOS_TENANT_HOSTS=1, and a local, uncommitted "*.lifeos-harness.test" in next.config.ts allowedDevOrigins,
 * because the dev server refuses unknown hosts its dev scripts (dev only). Chromium maps *.test to this machine, so the hostnames are real
 * to the browser and the server. It REFUSES anything but the staging project, turns the staging gate on for its run and off
 * at the end, and hard-deletes nothing. A real DNS record cannot exist for these names, so the verified state is written
 * directly here, and the TXT check itself is covered by the unit tests and by its refusal below.
 */
import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { chromium } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { supabaseStore } from "../src/lib/lifeos/adapters/supabase-store";
import { ISSUER_COMPETEN_AUTH, addMember, grantEntitlement, provisionIndividual, provisionOrganisation } from "../src/lib/lifeos/core/provision";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "";
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.STAGING_ANON_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || verdict.ref !== "ezhvpgtcqcdsgylrxgdb" || !serviceKey || !anonKey) {
  console.error("REFUSING: this harness runs against the staging project only.");
  process.exit(1);
}
const BASE = process.env.LIFEOS_BASE_URL ?? "http://localhost:3117";
const PORT = new URL(BASE).port;
const API = `${BASE}/api/lifeos/v1`;
const admin: any = createClient(url, serviceKey, { auth: { persistSession: false } });
const store = supabaseStore(admin);
const RUN = Date.now().toString(36);
const PASSWORD = randomBytes(24).toString("base64url");

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: unknown, msg: string, extra?: unknown) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}${extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 300)}` : ""}`); }
};
const setGate = (enabled: boolean) => admin.from("lifeos_flag").upsert({ flag: "lifeos_core", enabled, note: "staging tenant harness", updated_at: new Date().toISOString() });

async function person(tag: string) {
  const email = `lifeos-ten-${tag}-${RUN}@competen.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message}`);
  const jar = new Map<string, string>();
  const c = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (all: { name: string; value: string }[]) => { for (const { name, value } of all) jar.set(name, value); },
    },
  });
  const signed = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (signed.error) throw new Error(`signIn: ${signed.error.message}`);
  const p = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: data.user.id, displayName: `Harness ${tag}`, accessSource: "organisation" });
  await grantEntitlement(store, p.individualId, { individualId: p.individualId, source: "platform_grant", planCode: "tenant-harness" });
  return { email, individualId: p.individualId, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}

type Res = { status: number; body: any; text: string };
async function http(cookie: string, method: string, path: string, body?: unknown): Promise<Res> {
  const write = method !== "GET";
  const headers: Record<string, string> = { cookie };
  if (write) { headers["content-type"] = "application/json"; headers["idempotency-key"] = randomBytes(8).toString("hex"); }
  const res = await fetch(`${API}${path}`, { method, headers, ...(write ? { body: JSON.stringify(body ?? {}) } : {}) });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
}

async function main() {
  console.log(`LIFEOS TENANT HARNESS -- target ${verdict.ok ? verdict.ref : "?"} via ${BASE} -- run ${RUN}\n`);
  await setGate(true);
  const owner = await person("owner");
  const member = await person("member");
  const outsider = await person("outsider");
  const org = await provisionOrganisation(store, owner.individualId, { slug: `tenant-${RUN}`, name: "Acme Group" });
  const otherOrg = await provisionOrganisation(store, member.individualId, { slug: `other-${RUN}`, name: "Another Org" });
  await addMember(store, owner.individualId, org.workspaceId, member.individualId);
  const T = `/tenants/${org.tenantId}`;

  // ---- the registry ----
  const mine = await http(owner.cookie, "GET", "/tenants");
  ok("R1", mine.status === 200 && mine.body.data.some((t: any) => t.id === org.tenantId), "a tenant's owner sees it", mine.status);
  const notOwner = await http(member.cookie, "GET", T);
  ok("R2", notOwner.status === 404, "a member who is not its owner is told it does not exist", notOwner.status);
  const notOwnerWrite = await http(outsider.cookie, "PATCH", T, { expectedVersion: 1, name: "Hijack" });
  ok("R3", notOwnerWrite.status === 404, "an outsider cannot change it", notOwnerWrite.status);
  const bad = await http(owner.cookie, "PATCH", T, { expectedVersion: 1, branding: { primaryColor: "red;}body{display:none" } });
  ok("R4", bad.status === 422, "branding is validated, so it cannot carry CSS", bad.status);
  const badLogo = await http(owner.cookie, "PATCH", T, { expectedVersion: 1, branding: { evil: "x" } });
  ok("R5", badLogo.status === 422, "branding holds only known fields", badLogo.status);
  const branded = await http(owner.cookie, "PATCH", T, { expectedVersion: 1, branding: { productName: "Acme Planner", primaryColor: "#7a1f5c" } });
  ok("R6", branded.status === 200 && branded.body.data.branding.productName === "Acme Planner", "its owner sets the name and colour", branded);

  // ---- domains ----
  const host = `plan-${RUN}.lifeos-harness.test`.toLowerCase();
  const claimName = `plan-${RUN}.acme-example.org`;
  const ours = await http(owner.cookie, "POST", `${T}/domains`, { hostname: "lifeos.competenhealthcare.com" });
  ok("D1", ours.status === 422, "a tenant cannot claim one of our names", ours.status);
  const junk = await http(owner.cookie, "POST", `${T}/domains`, { hostname: "not a host" });
  ok("D2", junk.status === 422, "...or something that is not a hostname", junk.status);
  const claim = await http(owner.cookie, "POST", `${T}/domains`, { hostname: claimName });
  ok("D3", claim.status === 201 && claim.body.data.status === "pending" && claim.body.data.verificationToken.length >= 16, "a claim starts pending, with a token to publish", claim.status);
  const dup = await http(member.cookie, "POST", `/tenants/${otherOrg.tenantId}/domains`, { hostname: claimName });
  ok("D4", dup.status === 201 && dup.body.data.status === "pending", "claiming a name proves nothing and blocks nobody: another organisation can also claim it", dup.status);
  const dupSame = await http(owner.cookie, "POST", `${T}/domains`, { hostname: claimName });
  ok("D4b", dupSame.status === 409, "...but one organisation holds one open claim per name", dupSame.status);
  const noTxt = await http(owner.cookie, "POST", `${T}/domains/${claim.body.data.id}/verify`, { expectedVersion: 1 });
  ok("D5", noTxt.status === 409 && noTxt.body.error.details?.name === `_lifeos-verify.${claimName}`, "verifying without the TXT record is refused, and says where it should be", noTxt);
  const stranger = await http(outsider.cookie, "POST", `${T}/domains/${claim.body.data.id}/verify`, { expectedVersion: 1 });
  ok("D6", stranger.status === 404, "an outsider cannot verify it", stranger.status);
  const removed = await http(owner.cookie, "POST", `${T}/domains/${claim.body.data.id}/remove`, { expectedVersion: 1 });
  ok("D7", removed.status === 200 && removed.body.data.status === "removed", "its owner can remove it", removed.status);
  const listed = await http(owner.cookie, "GET", `${T}/domains`);
  ok("D8", !listed.text.includes(claimName), "...and it leaves the list");
  const readd = await http(owner.cookie, "POST", `${T}/domains`, { hostname: claimName });
  ok("D9", readd.status === 201, "...and it can add the name again later", readd.status);
  const verifiedBoth = await store.mutate({
    actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_tenant_domain", op: "update", id: readd.body.data.id, values: { status: "verified", verified_at: new Date().toISOString() } }],
  }).then(() => "committed", (e: any) => e.code);
  const secondVerified = await store.mutate({
    actor: member.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_tenant_domain", op: "update", id: dup.body.data.id, values: { status: "verified", verified_at: new Date().toISOString() } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("D10", verifiedBoth === "committed" && secondVerified === "conflict", "only one organisation can hold a name verified, at the database", { verifiedBoth, secondVerified });
  await store.mutate({
    actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_tenant_domain", op: "update", id: readd.body.data.id, values: { status: "suspended" } }],
  });
  const fresh = (await store.get("lifeos_tenant_domain", readd.body.data.id)) as any;
  const reverify = await http(owner.cookie, "POST", `${T}/domains/${readd.body.data.id}/verify`, { expectedVersion: fresh.version });
  ok("D11", reverify.status === 409, "a suspended domain cannot verify itself back", reverify.status);

  // A real hostname for the browser. Verified directly, because no real DNS record exists for it.
  const d = crypto.randomUUID();
  await store.mutate({
    actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_tenant_domain", op: "insert", values: { id: d, tenant_id: org.tenantId, hostname: host, verification_token: randomBytes(24).toString("hex"), status: "verified", verified_at: new Date().toISOString(), provenance_source: "system" } }],
  });
  await store.mutate({
    actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_tenant_domain", op: "insert", values: { tenant_id: org.tenantId, hostname: `pending-${host}`, verification_token: randomBytes(24).toString("hex"), provenance_source: "system" } }],
  });

  // ---- the browser, on the tenant's own hostname ----
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP *.test 127.0.0.1"] });
  try {
    const site = `http://${host}:${PORT}`;
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(`${site}/`, { timeout: 180000 });
    await p.getByRole("heading", { name: "Sign in to Acme Planner" }).waitFor({ timeout: 90000 });
    ok("B1", p.url().startsWith(site), "the root of the tenant's domain shows its own sign-in, and stays on its domain", p.url());
    for (const path of ["/login", "/super-admin", "/individual", "/practice/home", "/api/v1/practice/capabilities"]) {
      const tab = await ctx.newPage();
      const r = await tab.goto(`${site}${path}`, { timeout: 120000 });
      ok(`B2 ${path}`, r?.status() === 404, `${path} does not exist on a tenant's domain`, r?.status());
      await tab.close();
    }
    const pendingPage = await ctx.newPage();
    const pend = await pendingPage.goto(`http://pending-${host}:${PORT}/`, { timeout: 120000 });
    ok("B3", pend?.status() === 404, "a domain that is not verified serves nothing", pend?.status());
    await pendingPage.close();
    const unknown = await ctx.newPage();
    const unk = await unknown.goto(`http://nobody-${RUN}.lifeos-harness.test:${PORT}/`, { timeout: 120000 });
    ok("B4", unk?.status() === 404, "an unknown hostname serves nothing", unk?.status());
    await unknown.close();

    await p.getByLabel("Email").fill(member.email);
    await p.getByLabel("Password").fill("not-the-password");
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.getByText("did not match").waitFor({ timeout: 60000 });
    ok("B5b", !p.url().includes("not-the-password") && !p.url().includes("password="), "the password never reaches the address", p.url());
    ok("B5", (await p.getByRole("main").textContent())?.includes("That email and password did not match."), "a wrong password is refused, and says nothing else");
    await p.getByLabel("Password").fill(PASSWORD);
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.getByRole("heading", { name: "Calendar", level: 1 }).waitFor({ timeout: 90000 });
    ok("B6", p.url().startsWith(site), "they sign in and stay on the tenant's domain");
    const asideText = await p.locator("aside").textContent();
    ok("B7", asideText?.includes("Acme Planner") && !asideText?.includes("Competen"), "the product carries the tenant's name, and not ours", asideText?.slice(0, 80));
    const color = await p.evaluate(() => getComputedStyle(document.querySelector('[class*="root"]')!).getPropertyValue("--lo-primary").trim());
    ok("B8", color === "#7a1f5c", "the tenant's colour is applied", color);
    await p.locator("#lo-ws").waitFor({ timeout: 60000 });
    const options = await p.locator("#lo-ws option").allTextContents();
    ok("B9", options.includes("Acme Group") && options.includes("Personal") && !options.includes("Another Org"), "they see this organisation and their personal workspace, and no other organisation", options);
    ok("B10", (await p.locator("#lo-ws").inputValue()) === org.workspaceId, "it opens on this organisation's workspace");

    // The same person keeps their continuity on the main host, signed in there separately.
    const main = await browser.newContext();
    await main.addCookies(member.cookie.split("; ").map(c => { const i = c.indexOf("="); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
    const mp = await main.newPage();
    await mp.goto(`${BASE}/lifeos`, { timeout: 120000 });
    await mp.locator("#lo-ws").waitFor({ timeout: 60000 });
    const mainOptions = await mp.locator("#lo-ws option").allTextContents();
    ok("B11", mainOptions.includes("Another Org") && mainOptions.includes("Acme Group") && mainOptions.includes("Personal"), "on the main host the same person keeps everything they belong to", mainOptions);
    await main.close();

    const firstParty = await ctx.request.get(`${BASE}/login`, { maxRedirects: 0 });
    ok("B12", firstParty.status() === 200, "the main application's host is unaffected", firstParty.status());

    await p.locator("aside").getByRole("button", { name: "Sign out" }).click();
    await p.getByRole("heading", { name: "Sign in to Acme Planner" }).waitFor({ timeout: 60000 });
    ok("B13", p.url().startsWith(site), "signing out returns to the tenant's own sign-in");

    // Suspending the tenant takes the domain down
    const [t] = await store.where("lifeos_tenant", { id: org.tenantId });
    await store.mutate({ actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_tenant", op: "update", id: org.tenantId, expected_version: Number(t.version), values: { status: "suspended" } }] });
    const down = await p.goto(`${site}/`, { timeout: 120000 });
    ok("B14", down?.status() === 404, "a suspended organisation's domain serves nothing", down?.status());
    await store.mutate({ actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_domain_nothing", op: "insert", values: {} }] }).then(
      () => ok("W1", false, "the writer refuses a table that does not exist"),
      () => ok("W1", true, "the writer refuses a table that does not exist"),
    );
    for (const table of ["lifeos_audit_event", "lifeos_quadrant_classification", "lifeos_flag", "lifeos_terms", "lifeos_idempotency", "lifeos_live_grant", "profiles"]) {
      const r = await store.mutate({ actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: table, op: "insert", values: { provenance_source: "system" } }] }).then(() => "committed", (e: any) => e.code);
      ok(`W2 ${table}`, r === "validation_failed", `the writer still refuses ${table}`, r);
    }
    const [t2] = await store.where("lifeos_tenant", { id: org.tenantId });
    await store.mutate({ actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_tenant", op: "update", id: org.tenantId, expected_version: Number(t2.version), values: { status: "active" } }] });
  } finally {
    await browser.close();
  }

  await setGate(false);
  const off = await fetch(`${API}/me`);
  ok("Z1", off.status === 404, "gate off again. Staging is left OFF", off.status);
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map(f => `  - ${f}`).join("\n")); process.exit(1); }
}

main().catch(async e => {
  console.error(String(e).slice(0, 1200));
  await setGate(false);
  process.exit(1);
});
