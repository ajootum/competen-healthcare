/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LIFEOS-API-001 delivery step 8: what an external organisation pilot needs, over real HTTP and in a real browser, on staging.
 * The success measure in the owner's brief: one person joins an organisation without losing personal continuity or exposing
 * anything private, and leaves again the same way.
 *
 *   LIFEOS_BASE_URL=http://localhost:3117 npx tsx scripts/lifeos-pilot-harness.ts
 *
 * It REFUSES anything but the staging project, turns the staging gate on for its run and off at the end, and hard-deletes nothing.
 */
import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { chromium } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { supabaseStore } from "../src/lib/lifeos/adapters/supabase-store";
import { ISSUER_COMPETEN_AUTH, grantEntitlement, provisionIndividual, provisionOrganisation } from "../src/lib/lifeos/core/provision";

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
const setGate = (enabled: boolean) => admin.from("lifeos_flag").upsert({ flag: "lifeos_core", enabled, note: "staging pilot harness", updated_at: new Date().toISOString() });

async function account(tag: string) {
  const email = `lifeos-pilot-${tag}-${RUN}@competen.test`;
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
  return { email, subject: data.user.id as string, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}
async function http(cookie: string, method: string, path: string, body?: unknown) {
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
  console.log(`LIFEOS PILOT HARNESS -- target ${verdict.ok ? verdict.ref : "?"} via ${BASE} -- run ${RUN}\n`);
  await setGate(true);
  const ownerAcc = await account("owner");
  const owner = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: ownerAcc.subject, displayName: "Org Owner", accessSource: "organisation" });
  await grantEntitlement(store, owner.individualId, { individualId: owner.individualId, source: "platform_grant", planCode: "pilot-harness" });
  const org = await provisionOrganisation(store, owner.individualId, { slug: `pilot-${RUN}`, name: "Pilot Org" });
  const W = `/workspaces/${org.workspaceId}`;

  // A person who already uses LifeOS on their own, with private personal work
  const personAcc = await account("person");
  const person = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: personAcc.subject, displayName: "Direct Person", accessSource: "direct" });
  await grantEntitlement(store, person.individualId, { individualId: person.individualId, source: "direct", planCode: "pilot-harness" });
  const PW = `/workspaces/${person.personalWorkspaceId}`;
  const SECRET = `My private plan ${RUN}`;
  const personal = await http(personAcc.cookie, "POST", `${PW}/commitments`, { title: SECRET });
  ok("C0", personal.status === 201, "they have private personal work before joining anything", personal.status);

  // A person new to LifeOS, whose only access comes through the organisation
  const newAcc = await account("new");

  // ---- invitations ----
  const retryKey = randomBytes(8).toString("hex");
  const firstCreate = await fetch(`${API}${W}/invitations`, { method: "POST", headers: { cookie: ownerAcc.cookie, "content-type": "application/json", "idempotency-key": retryKey }, body: JSON.stringify({ email: `retry-${RUN}@competen.test` }) });
  const secondCreate = await fetch(`${API}${W}/invitations`, { method: "POST", headers: { cookie: ownerAcc.cookie, "content-type": "application/json", "idempotency-key": retryKey }, body: JSON.stringify({ email: `retry-${RUN}@competen.test` }) });
  const [fc, sc] = [await firstCreate.json(), await secondCreate.json()];
  ok("I0", !!fc.data.token && sc.data.token === null && sc.meta.replayed === true && sc.data.invitation.id === fc.data.invitation.id, "retrying a create finds the same invitation, and never hands out a link that would not work", sc);
  const inv = await http(ownerAcc.cookie, "POST", `${W}/invitations`, { email: personAcc.email.toUpperCase() });
  ok("I1", inv.status === 201 && inv.body.data.token?.length >= 40 && inv.body.data.invitation.email === personAcc.email, "an owner invites one address, normalised, and gets a link once", inv.status);
  const token = inv.body.data.token as string;
  const stored = (await admin.from("lifeos_invitation").select("*").eq("id", inv.body.data.invitation.id).single()).data;
  ok("I2", !JSON.stringify(stored).includes(token) && stored.token_hash.length === 64, "the database holds only a hash of the token");
  const listed = await http(ownerAcc.cookie, "GET", `${W}/invitations`);
  ok("I3", listed.status === 200 && !listed.text.includes(token) && !listed.text.includes("tokenHash"), "listing invitations never shows the token or its hash");
  const personalInvite = await http(personAcc.cookie, "POST", `${PW}/invitations`, { email: newAcc.email });
  ok("I4", personalInvite.status === 403 || personalInvite.status === 409, "nobody can be invited into a personal workspace", personalInvite.status);
  const strangerInvite = await http(personAcc.cookie, "POST", `${W}/invitations`, { email: "x@competen.test" });
  ok("I5", strangerInvite.status === 404, "someone outside the organisation cannot invite to it", strangerInvite.status);

  const wrongPerson = await http(newAcc.cookie, "POST", "/access/invitation", { token });
  ok("A1", wrongPerson.status === 403, "someone signed in with another address cannot use the link", wrongPerson.status);
  const badToken = await http(personAcc.cookie, "POST", "/access/invitation", { token: "x".repeat(43) });
  ok("A2", badToken.status === 404, "a made-up token is refused", badToken.status);
  const beforeJoin = await http(personAcc.cookie, "GET", W);
  ok("A3", beforeJoin.status === 404, "before accepting, the organisation is invisible to them", beforeJoin.status);
  const accept = await http(personAcc.cookie, "POST", "/access/invitation", { token });
  ok("A4", accept.status === 200 && accept.body.data.individualId === person.individualId, "the invited person accepts, and keeps their one LifeOS identity", accept);
  const again = await http(personAcc.cookie, "POST", "/access/invitation", { token });
  ok("A5", again.status === 404, "the link works once", again.status);

  // ---- no private information crosses ----
  const me = await http(personAcc.cookie, "GET", "/me");
  ok("X1", me.body.data.workspaces.length === 2, "they now have their personal workspace and the organisation's");
  const ownerReads = await http(ownerAcc.cookie, "GET", `${PW}/commitments`);
  ok("X2", ownerReads.status === 404, "the organisation's owner still cannot see their personal workspace", ownerReads.status);
  const orgPrivate = await http(personAcc.cookie, "POST", `${W}/commitments`, { title: `Org private ${RUN}` });
  const ownerList = await http(ownerAcc.cookie, "GET", `${W}/commitments`);
  ok("X3", orgPrivate.status === 201 && !ownerList.text.includes(`Org private ${RUN}`), "the owner cannot read what they keep private in the organisation's workspace either", ownerList.status);
  const shared = await http(personAcc.cookie, "POST", `${W}/commitments`, { title: `Org shared ${RUN}`, accessScope: "workspace" });
  const ownerShared = await http(ownerAcc.cookie, "GET", `${W}/commitments`);
  ok("X4", shared.status === 201 && ownerShared.text.includes(`Org shared ${RUN}`), "...until they choose to share a record");
  const dir = await http(personAcc.cookie, "GET", `${W}/directory`);
  ok("X5", dir.status === 200 && dir.body.data.some((d: any) => d.displayName === "Org Owner") && !dir.text.includes("competen.test"), "the member list gives names for delegating, and no addresses", dir.body);
  const dirOut = await http(newAcc.cookie, "GET", `${W}/directory`);
  ok("X6", dirOut.status === 403 || dirOut.status === 404, "someone outside cannot read the member list", dirOut.status);
  const members = await http(personAcc.cookie, "GET", `${W}/members`);
  ok("X7", members.status === 403, "a member cannot read the administrative member list", members.status);
  const world = await http(personAcc.cookie, "POST", `${W}/worlds`, { title: "Work" });
  const task = await http(personAcc.cookie, "POST", `${W}/commitments`, { title: `For the owner ${RUN}`, worldId: world.body.data.id, important: true, urgent: false });
  const delegated = await http(personAcc.cookie, "POST", `${W}/delegations`, { commitmentId: task.body.data.id, delegateeIndividualId: owner.individualId, followUpOn: "2099-01-01" });
  const ownerSees = await http(ownerAcc.cookie, "GET", `${W}/commitments/${task.body.data.id}`);
  ok("X8", delegated.status === 201 && ownerSees.status === 200, "delegating to a member lets them read that one commitment", [delegated.status, ownerSees.status]);

  // ---- leaving, with personal continuity ----
  const leave = await http(personAcc.cookie, "POST", `${W}/leave`, {});
  ok("L1", leave.status === 200, "they leave the organisation", leave.status);
  const stillPersonal = await http(personAcc.cookie, "GET", `${PW}/commitments`);
  ok("L2", stillPersonal.status === 200 && stillPersonal.text.includes(SECRET), "their personal work is intact", stillPersonal.status);
  const orgGone = await http(personAcc.cookie, "GET", W);
  ok("L3", orgGone.status === 404, "and the organisation is gone for them", orgGone.status);

  // ---- a person whose only access is the organisation ----
  const inv2 = await http(ownerAcc.cookie, "POST", `${W}/invitations`, { email: newAcc.email, role: "member" });
  const none = await http(newAcc.cookie, "GET", "/me");
  ok("N1", none.status === 403, "an invited person has nothing until they accept", none.status);
  const accept2 = await http(newAcc.cookie, "POST", "/access/invitation", { token: inv2.body.data.token });
  const meNew = await http(newAcc.cookie, "GET", "/me");
  ok("N2", accept2.status === 200 && meNew.status === 200 && meNew.body.data.entitlements[0].source === "organisation" && meNew.body.data.workspaces.some((w: any) => w.kind === "personal"), "accepting gives them LifeOS through the organisation, with a personal workspace of their own", meNew.status);
  const NW = `/workspaces/${meNew.body.data.workspaces.find((w: any) => w.kind === "personal").id}`;
  const own = await http(newAcc.cookie, "POST", `${NW}/commitments`, { title: `Mine ${RUN}` });
  const [t1] = await store.where("lifeos_tenant", { id: org.tenantId });
  await store.mutate({ actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_tenant", op: "update", id: org.tenantId, expected_version: Number(t1.version), values: { status: "suspended" } }] });
  const suspended = await http(newAcc.cookie, "GET", "/me");
  ok("N3", own.status === 201 && suspended.status === 403, "if the organisation is suspended, access through it ends", suspended.status);
  const personUnaffected = await http(personAcc.cookie, "GET", "/me");
  ok("N4", personUnaffected.status === 200, "someone with their own access is unaffected", personUnaffected.status);
  const [t2] = await store.where("lifeos_tenant", { id: org.tenantId });
  await store.mutate({ actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_tenant", op: "update", id: org.tenantId, expected_version: Number(t2.version), values: { status: "active" } }] });
  const back = await http(newAcc.cookie, "GET", `${NW}/commitments`);
  ok("N5", back.status === 200 && back.text.includes(`Mine ${RUN}`), "when it returns, their records are still there", back.status);
  const leave2 = await http(newAcc.cookie, "POST", `${W}/leave`, {});
  const afterLeave = await http(newAcc.cookie, "GET", "/me");
  ok("N6", leave2.status === 200 && afterLeave.status === 403, "leaving ends access that came only through the organisation", afterLeave.status);

  // ---- taking their records with them, after access has ended ----
  const exported = await http(newAcc.cookie, "GET", "/access/export");
  ok("V1", exported.status === 200 && exported.body.data.format === "lifeos-export-v1" && exported.text.includes(`Mine ${RUN}`), "someone whose access has ended can still export their own records", exported.status);
  ok("V2", !exported.text.includes(SECRET) && !exported.text.includes(`Org shared ${RUN}`), "the export holds only what they own");
  ok("V3", Array.isArray(exported.body.data.truncated) && exported.body.data.truncated.length === 0, "and it says whether anything was left out");
  const statusAfter = await http(newAcc.cookie, "GET", "/access/status");
  ok("V4", statusAfter.body.data.hasRecords === true && statusAfter.body.data.active === false, "the page can tell them their records are kept", statusAfter.body);
  const nobody = await account("nobody");
  const noRecords = await http(nobody.cookie, "GET", "/access/export");
  ok("V5", noRecords.status === 404, "someone with no LifeOS records gets nothing", noRecords.status);
  const anonExport = await fetch(`${API}/access/export`);
  ok("V6", anonExport.status === 401, "and it needs a signed-in person", anonExport.status);
  const connFixture = crypto.randomUUID();
  await store.mutate({ actor: person.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_integration_connection", op: "insert", values: { id: connFixture, workspace_id: person.personalWorkspaceId, owner_individual_id: person.individualId, provider: "x", credential_ref: `vault://${RUN}`, provenance_source: "system" } }] });
  const personExport = await http(personAcc.cookie, "GET", "/access/export");
  ok("V7", !personExport.text.includes("vault://") && !personExport.text.includes("dedupe_key"), "an export never holds credential references or internal bookkeeping");

  // ---- accepting cannot change a standing member ----
  const ownerSelf = await http(ownerAcc.cookie, "POST", `${W}/invitations`, { email: ownerAcc.email, role: "member" });
  const ownerAccepts = await http(ownerAcc.cookie, "POST", "/access/invitation", { token: ownerSelf.body.data.token });
  const ownerRole = (await store.where("lifeos_membership", { workspace_id: org.workspaceId, individual_id: owner.individualId }))[0];
  ok("R1", ownerAccepts.status === 200 && ownerRole.role === "owner" && ownerRole.status === "active", "accepting a member invitation does not demote the owner", ownerRole?.role);
  const adminAcc = await account("admin");
  const adminP = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: adminAcc.subject, displayName: "An Admin", accessSource: "organisation" });
  await grantEntitlement(store, adminP.individualId, { individualId: adminP.individualId, source: "platform_grant", planCode: "pilot-harness" });
  const adminInv = await http(ownerAcc.cookie, "POST", `${W}/invitations`, { email: adminAcc.email, role: "admin" });
  await http(adminAcc.cookie, "POST", "/access/invitation", { token: adminInv.body.data.token });
  const selfInvite = await http(adminAcc.cookie, "POST", `${W}/invitations`, { email: adminAcc.email, role: "admin" });
  const leaves = await http(adminAcc.cookie, "POST", `${W}/leave`, {});
  const comesBack = await http(adminAcc.cookie, "POST", "/access/invitation", { token: selfInvite.body.data.token });
  ok("R2", leaves.status === 200 && comesBack.status === 404, "an admin who leaves cannot return through an invitation they wrote for themselves", comesBack.status);
  const adminInv2 = await http(ownerAcc.cookie, "POST", `${W}/invitations`, { email: adminAcc.email, role: "member" });
  const [mem] = await store.where("lifeos_membership", { workspace_id: org.workspaceId, individual_id: adminP.individualId });
  await store.mutate({ actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_membership", op: "update", id: String(mem.id), workspace_id: org.workspaceId, values: { status: "suspended" } }] });
  const suspendedBack = await http(adminAcc.cookie, "POST", "/access/invitation", { token: adminInv2.body.data.token });
  ok("R3", suspendedBack.status === 403, "someone suspended cannot restore themselves by accepting an invitation", suspendedBack.status);

  // ---- expiry and revocation ----
  const inv3 = await http(ownerAcc.cookie, "POST", `${W}/invitations`, { email: "gone@competen.test" });
  const revoke = await http(ownerAcc.cookie, "POST", `${W}/invitations/${inv3.body.data.invitation.id}/revoke`, { expectedVersion: 1 });
  ok("E1", revoke.status === 200 && revoke.body.data.status === "revoked", "an invitation can be withdrawn", revoke.status);
  const inv4 = await http(ownerAcc.cookie, "POST", `${W}/invitations`, { email: personAcc.email });
  await store.mutate({ actor: owner.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_invitation", op: "update", id: inv4.body.data.invitation.id, workspace_id: org.workspaceId, values: { expires_at: "2020-01-01T00:00:00Z" } }] });
  const expired = await http(personAcc.cookie, "POST", "/access/invitation", { token: inv4.body.data.token });
  ok("E2", expired.status === 404, "an expired link is refused, judged by the database clock", expired.status);

  // ---- the browser ----
  const browser = await chromium.launch();
  try {
    const ownerCtx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
    await ownerCtx.addCookies(ownerAcc.cookie.split("; ").map(c => { const i = c.indexOf("="); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
    const op = await ownerCtx.newPage();
    await op.goto(`${BASE}/lifeos`, { timeout: 180000 });
    await op.locator("#lo-ws").waitFor({ timeout: 90000 });
    await op.locator("#lo-ws").selectOption({ label: "Pilot Org" });
    await op.locator("aside nav").getByRole("button", { name: "Organisation" }).click();
    await op.getByRole("heading", { name: "Invite people" }).waitFor({ timeout: 60000 });
    await op.getByRole("heading", { name: "Name and look" }).waitFor({ timeout: 60000 }).catch(() => {});
    ok("U1", await op.getByRole("heading", { name: "Name and look" }).isVisible(), "the owner has an Organisation screen, with no code needed");
    const browserAcc = await account("browser");
    await op.getByLabel("Email").fill(browserAcc.email);
    await op.getByRole("button", { name: "Create invitation" }).click();
    const linkEl = op.getByTestId("invite-link");
    await linkEl.waitFor({ timeout: 60000 });
    const link = (await linkEl.textContent()) ?? "";
    ok("U2", link.includes("/lifeos/invite/"), "they get a link to send");
    await op.getByRole("button", { name: "Revoke" }).first().waitFor({ timeout: 30000 });

    const inviteeCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const ip = await inviteeCtx.newPage();
    await ip.goto(link, { timeout: 120000 });
    await ip.getByRole("heading", { name: /You are invited/ }).waitFor({ timeout: 60000 });
    const page = await ip.textContent("main");
    ok("U3", page?.includes("Pilot Org") && !page.includes(browserAcc.email.split("@")[0].slice(1)), "the link names the organisation, and only hints at the address", page?.slice(0, 120));
    ok("U4", page?.includes("cannot read what you keep private"), "it says plainly what the organisation cannot see");
    ok("U4b", (await ip.getByRole("button", { name: "Create account" }).count()) === 0 && (await ip.getByText("Choose a password").count()) === 0, "nobody can set a password for the invited address from this link while signed out");
    ok("U4c", await ip.getByRole("button", { name: "Email me a link" }).isVisible(), "someone new proves the address by email first");
    await ip.getByLabel("Password, if you already have an account").fill("not-the-password");
    await ip.getByRole("button", { name: "Sign in" }).click();
    await ip.getByText("did not match").waitFor({ timeout: 60000 });
    await ip.getByLabel("Password, if you already have an account").fill(PASSWORD);
    await ip.getByRole("button", { name: "Sign in" }).click();
    await ip.getByRole("button", { name: "Accept and open" }).click({ timeout: 90000 });
    await ip.locator("main h1", { hasText: "Calendar" }).waitFor({ timeout: 90000 });
    ok("U5", true, "a new person signs in on a phone, accepts, and arrives in LifeOS");

    const dead = await browser.newContext();
    const dp = await dead.newPage();
    const deadRes = await dp.goto(`${BASE}/lifeos/invite/not-a-real-token-at-all-${RUN}`, { timeout: 120000 });
    ok("U6", deadRes?.status() === 404, "a dead link shows nothing", deadRes?.status());

    // ---- the organisation ends someone's access, on screen ----
    op.on("dialog", d => { void d.accept(); });
    await op.reload({ timeout: 120000 });
    await op.locator("#lo-ws").waitFor({ timeout: 90000 });
    await op.locator("#lo-ws").selectOption({ label: "Pilot Org" });
    await op.locator("aside nav").getByRole("button", { name: "Organisation" }).click();
    await op.getByRole("heading", { name: "People", exact: true }).waitFor({ timeout: 60000 });
    await op.getByText(/· member$/).last().waitFor({ timeout: 60000 });
    const ownerRemovable = await op.getByText(/· owner$/).first().locator("..").getByRole("button", { name: "Remove", exact: true }).count();
    const before = await op.getByText(/· member$/).count();
    ok("U7", before >= 1 && ownerRemovable === 0, "the owner sees the people in the organisation, and cannot remove the owner", [before, ownerRemovable]);
    await op.getByText(/· member$/).last().locator("..").getByRole("button", { name: "Remove", exact: true }).click();
    await op.waitForFunction(n => [...document.querySelectorAll("span")].filter(e => /· member$/.test(e.textContent ?? "")).length === n - 1, before, { timeout: 60000 });
    ok("U8", true, "removing someone takes them off the list");
    await ip.goto(`${BASE}/lifeos`, { timeout: 120000 });
    await ip.getByRole("heading", { name: "LifeOS is not enabled for this account" }).waitFor({ timeout: 90000 });
    ok("U9", true, "and access that came only through the organisation ends");
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
