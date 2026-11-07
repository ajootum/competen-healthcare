/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The independent security review of the LifeOS public API, as attacks. Each check is a finding from that review. Run against
 * the code before the fix, the checks for confirmed findings go red, which is what confirmed them. Run after it, they hold.
 *
 *   LIFEOS_BASE_URL=http://localhost:3117 npx tsx scripts/lifeos-token-boundary-harness.ts
 *
 * Real tokens over real HTTP on staging. It REFUSES anything but the staging project, turns the staging flags on for its run
 * and off at the end, and hard-deletes nothing.
 */
import { createHash, randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { supabaseStore } from "../src/lib/lifeos/adapters/supabase-store";
import { approve } from "../src/lib/lifeos/core/oauth";
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
const API = `${process.env.LIFEOS_BASE_URL ?? "http://localhost:3117"}/api/lifeos/v1`;
const admin: any = createClient(url, serviceKey, { auth: { persistSession: false } });
const store = supabaseStore(admin);
const RUN = Date.now().toString(36);
const PASSWORD = randomBytes(24).toString("base64url");
const REDIRECT = "http://localhost:9/callback";
const ALL = ["profile:read", "commitments:read", "commitments:write", "worlds:read", "schedules:read"];

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: unknown, msg: string, extra?: unknown) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}${extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 220)}` : ""}`); }
};
const setFlag = (flag: string, enabled: boolean) => admin.from("lifeos_flag").upsert({ flag, enabled, note: "staging token boundary harness", updated_at: new Date().toISOString() });

async function person(tag: string) {
  const email = `lifeos-tok-${tag}-${RUN}@competen.test`;
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
  const p = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: data.user.id, displayName: `Tok ${tag}`, accessSource: "direct" });
  await grantEntitlement(store, p.individualId, { individualId: p.individualId, source: "platform_grant", planCode: "boundary" });
  return { ...p, subject: data.user.id as string, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}
type Res = { status: number; body: any; text: string };
async function call(auth: { cookie?: string; token?: string }, method: string, path: string, body?: unknown, key?: string): Promise<Res> {
  const write = method !== "GET";
  const headers: Record<string, string> = {};
  if (auth.cookie) headers.cookie = auth.cookie;
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  if (write) { headers["content-type"] = "application/json"; headers["idempotency-key"] = key ?? randomBytes(8).toString("hex"); }
  const res = await fetch(`${API}${path}`, { method, headers, ...(write ? { body: JSON.stringify(body ?? {}) } : {}) });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
}
const tokenCall = async (form: Record<string, string>) => {
  const res = await fetch(`${API}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  return { status: res.status, body: await res.json().catch(() => null) as any };
};
async function tokenFor(individualId: string, clientId: string, scope: string, workspaceId: string) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const { redirect } = await approve(store, individualId, { clientId, redirectUri: REDIRECT, scope, codeChallenge: challenge, codeChallengeMethod: "S256", workspaceId }, "boundary");
  const code = new URL(redirect).searchParams.get("code") ?? "";
  const t = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT });
  if (t.status !== 200) throw new Error(`token: ${JSON.stringify(t.body)}`);
  return t.body as { access_token: string; refresh_token: string; workspace_id: string };
}
const sys = (actor: string, ops: any[]) => store.mutate({ actor, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops });

async function main() {
  console.log(`LIFEOS TOKEN BOUNDARY HARNESS -- target ${verdict.ok ? verdict.ref : "?"} -- run ${RUN}\n`);
  await setFlag("lifeos_core", true);
  await setFlag("lifeos_public_api", true);

  const alice = await person("alice");
  const bob = await person("bob");
  const org = await provisionOrganisation(store, alice.individualId, { slug: `tok-${RUN}`, name: "Org B" });
  await addMember(store, alice.individualId, org.workspaceId, bob.individualId, "admin");
  const W = `/workspaces/${org.workspaceId}`;

  const clientId = crypto.randomUUID();
  const clientB = crypto.randomUUID();
  await sys(alice.individualId, [
    { t: "lifeos_api_client", op: "insert", values: { id: clientId, name: `App A ${RUN}`, redirect_uris: [REDIRECT], allowed_scopes: ALL, status: "approved", provenance_source: "system" } },
    { t: "lifeos_api_client", op: "insert", values: { id: clientB, name: `App B ${RUN}`, redirect_uris: [REDIRECT], allowed_scopes: ALL, status: "approved", provenance_source: "system" } },
  ]);

  // Alice's records in the shared organisation workspace
  const worldShared = await call({ cookie: alice.cookie }, "POST", `${W}/worlds`, { title: `Shared world ${RUN}`, accessScope: "workspace" });
  const shared = await call({ cookie: alice.cookie }, "POST", `${W}/commitments`, { title: `Alice shared ${RUN}`, accessScope: "workspace" });
  const aliceTask = await call({ cookie: alice.cookie }, "POST", `${W}/commitments`, { title: `Alice delegated ${RUN}`, worldId: worldShared.body.data.id, important: true, urgent: false });
  await call({ cookie: alice.cookie }, "POST", `${W}/delegations`, { commitmentId: aliceTask.body.data.id, delegateeIndividualId: bob.individualId, followUpOn: "2099-01-01" });
  const alicePrivate = await call({ cookie: alice.cookie }, "POST", `${W}/commitments`, { title: `Alice private ${RUN}` });
  const blockShared = await call({ cookie: alice.cookie }, "POST", `${W}/calendar-events`, { title: `Alice meeting ${RUN}`, startsAt: "2099-01-01T08:00:00Z", endsAt: "2099-01-01T09:00:00Z", accessScope: "workspace" });
  const bobOwn = await call({ cookie: bob.cookie }, "POST", `${W}/commitments`, { title: `Bob own ${RUN}` });
  ok("S0", worldShared.status === 201 && shared.status === 201 && alicePrivate.status === 201 && blockShared.status === 201 && bobOwn.status === 201, "fixtures are in place");

  const bobToken = await tokenFor(bob.individualId, clientId, ALL.join(" "), org.workspaceId);

  // ---- H1: a token reaches only the approving person's own records ----
  const list = await call({ token: bobToken.access_token }, "GET", `${W}/commitments`);
  ok("H1a", list.status === 200 && list.text.includes(`Bob own ${RUN}`), "an app can read the records of the person who approved it", list.status);
  ok("H1b", !list.text.includes(`Alice shared ${RUN}`), "an app cannot read a colleague's workspace-shared commitment, which the colleague never approved");
  ok("H1c", !list.text.includes(`Alice delegated ${RUN}`), "an app cannot read a colleague's commitment delegated to the person");
  ok("H1d", !list.text.includes(`Alice private ${RUN}`), "an app cannot read a colleague's private commitment");
  const one = await call({ token: bobToken.access_token }, "GET", `${W}/commitments/${shared.body.data.id}`);
  ok("H1e", one.status === 404, "nor by asking for it directly", one.status);
  const worlds = await call({ token: bobToken.access_token }, "GET", `${W}/worlds`);
  ok("H1f", !worlds.text.includes(`Shared world ${RUN}`), "nor a colleague's shared world");
  const events = await call({ token: bobToken.access_token }, "GET", `${W}/calendar-events`);
  ok("H1g", !events.text.includes(`Alice meeting ${RUN}`), "nor a colleague's shared calendar");
  const adminWrite = await call({ token: bobToken.access_token }, "PATCH", `${W}/commitments/${shared.body.data.id}`, { expectedVersion: 1, title: "Changed by an app" });
  ok("H1h", adminWrite.status === 404, "an admin's token cannot change a colleague's shared record", adminWrite.status);
  const sessionStill = await call({ cookie: bob.cookie }, "GET", `${W}/commitments/${shared.body.data.id}`);
  ok("H1i", sessionStill.status === 200, "the person themselves still can, signed in", sessionStill.status);

  // ---- H2: an app cannot change who can see a record ----
  const share = await call({ token: bobToken.access_token }, "PATCH", `${W}/commitments/${bobOwn.body.data.id}`, { expectedVersion: 1, accessScope: "workspace" });
  ok("H2a", share.status === 403, "an app cannot make a private commitment visible to the organisation", share.status);
  const afterShare = await call({ cookie: alice.cookie }, "GET", `${W}/commitments/${bobOwn.body.data.id}`);
  ok("H2b", afterShare.status === 404, "and the organisation still cannot see it", afterShare.status);
  const createShared = await call({ token: bobToken.access_token }, "POST", `${W}/commitments`, { title: `App shared ${RUN}`, accessScope: "workspace" });
  ok("H2c", createShared.status === 403, "nor create one that is shared", createShared.status);
  const createPlain = await call({ token: bobToken.access_token }, "POST", `${W}/commitments`, { title: `App private ${RUN}` });
  ok("H2d", createPlain.status === 201 && createPlain.body.data.accessScope === "private", "it can still create a private one", createPlain.status);

  // ---- L5: an app cannot end a delegation ----
  const bobTask = await call({ cookie: bob.cookie }, "POST", `${W}/commitments`, { title: `Bob delegated ${RUN}`, worldId: (await call({ cookie: bob.cookie }, "POST", `${W}/worlds`, { title: "Bob world" })).body.data.id, important: true, urgent: false });
  const del = await call({ cookie: bob.cookie }, "POST", `${W}/delegations`, { commitmentId: bobTask.body.data.id, delegateeIndividualId: alice.individualId, followUpOn: "2099-01-01" });
  const freshTask = await call({ cookie: bob.cookie }, "GET", `${W}/commitments/${bobTask.body.data.id}`);
  const dropDel = await call({ token: bobToken.access_token }, "POST", `${W}/commitments/${bobTask.body.data.id}/transition`, { to: "dropped", expectedVersion: freshTask.body.data.version });
  ok("L5", del.status === 201 && dropDel.status === 403, "an app cannot cancel a delegation by moving its commitment", dropDel.status);

  // ---- L4: /me says what the consent screen says ----
  const me = await call({ token: bobToken.access_token }, "GET", "/me");
  ok("L4", me.status === 200 && me.body.data.individual.id === bob.individualId && !("entitlements" in me.body.data) && !("accessSource" in me.body.data.individual), "/me gives an app the name and workspaces, not plans or access details", Object.keys(me.body?.data ?? {}));

  const appBToken = await tokenFor(bob.individualId, clientB, ALL.join(" "), org.workspaceId);
  const byOtherApp = await call({ token: appBToken.access_token }, "GET", `${W}/commitments/${createPlain.body.data.id}`);
  ok("L4b", byOtherApp.status === 200 && byOtherApp.body.data.provenanceRef === null, "an app cannot see which other app made a record", byOtherApp.body?.data?.provenanceRef);
  const ownMark = await call({ token: bobToken.access_token }, "GET", `${W}/commitments/${createPlain.body.data.id}`);
  ok("L4c", ownMark.body?.data?.provenanceRef === clientId, "but it can see what it made itself", ownMark.body?.data?.provenanceRef);
  const wsList = await call({ token: bobToken.access_token }, "GET", "/workspaces");
  ok("L4d", wsList.status === 200 && wsList.body.data.length >= 1 && Object.keys(wsList.body.data[0]).sort().join() === "id,kind,name", "/workspaces gives an app the names and ids only", Object.keys(wsList.body?.data?.[0] ?? {}));

  // ---- L3: idempotency keys do not cross apps ----
  const sharedKey = `shared-key-${RUN}`;
  const fromA = await call({ token: bobToken.access_token }, "POST", `${W}/commitments`, { title: `Same key ${RUN}` }, sharedKey);
  const fromB = await call({ token: appBToken.access_token }, "POST", `${W}/commitments`, { title: `Same key ${RUN}` }, sharedKey);
  ok("L3", fromA.status === 201 && fromB.status === 201 && fromB.body.data.id !== fromA.body.data.id, "one app's key cannot retrieve another app's record", [fromA.status, fromB.status, fromB.body?.meta]);

  // ---- L6: approving again replaces the earlier approval ----
  const narrow = await tokenFor(bob.individualId, clientId, "profile:read", org.workspaceId);
  const oldWide = await call({ token: bobToken.access_token }, "GET", `${W}/commitments`);
  ok("L6", oldWide.status === 401, "approving an app again with less access ends the wider approval", oldWide.status);
  const narrowDenied = await call({ token: narrow.access_token }, "GET", `${W}/commitments`);
  ok("L6b", narrowDenied.status === 403, "and the new token holds only what was approved", narrowDenied.status);

  // ---- L2: client changes apply at once ----
  const carol = await person("carol");
  const carolWs = `/workspaces/${carol.personalWorkspaceId}`;
  const clientC = crypto.randomUUID();
  await sys(carol.individualId, [{ t: "lifeos_api_client", op: "insert", values: { id: clientC, name: `App C ${RUN}`, redirect_uris: [REDIRECT], allowed_scopes: ALL, status: "approved", provenance_source: "system" } }]);
  const carolToken = await tokenFor(carol.individualId, clientC, ALL.join(" "), carol.personalWorkspaceId);
  await sys(carol.individualId, [{ t: "lifeos_api_client", op: "update", id: clientC, values: { allowed_scopes: ["profile:read"] } }]);
  const narrowed = await call({ token: carolToken.access_token }, "GET", `${carolWs}/commitments`);
  ok("L2a", narrowed.status === 403, "narrowing what an app may hold applies to tokens it already has", narrowed.status);
  await sys(carol.individualId, [{ t: "lifeos_api_client", op: "update", id: clientC, values: { allowed_scopes: ALL, archived_at: new Date().toISOString() } }]);
  const archived = await call({ token: carolToken.access_token }, "GET", `${carolWs}/commitments`);
  ok("L2b", archived.status === 401, "archiving an app ends its tokens", archived.status);

  // ---- M2: losing LifeOS stops refresh, and the person can still disconnect ----
  const dave = await person("dave");
  const clientD = crypto.randomUUID();
  await sys(dave.individualId, [{ t: "lifeos_api_client", op: "insert", values: { id: clientD, name: `App D ${RUN}`, redirect_uris: [REDIRECT], allowed_scopes: ALL, status: "approved", provenance_source: "system" } }]);
  const daveToken = await tokenFor(dave.individualId, clientD, ALL.join(" "), dave.personalWorkspaceId);
  for (const e of await store.where("lifeos_entitlement", { individual_id: dave.individualId, status: "active" })) {
    await sys(dave.individualId, [{ t: "lifeos_entitlement", op: "update", id: String(e.id), values: { status: "revoked", revoked_at: new Date().toISOString() } }]);
  }
  const noAccess = await call({ token: daveToken.access_token }, "GET", "/me");
  ok("M2a", noAccess.status === 401, "losing LifeOS stops the app's token", noAccess.status);
  const listApps = await call({ cookie: dave.cookie }, "GET", "/me/connected-apps");
  ok("M2c", listApps.status === 200 && listApps.body.data.length === 1, "the person can still see the app", listApps.status);
  const discon = await call({ cookie: dave.cookie }, "POST", `/me/connected-apps/${listApps.body?.data?.[0]?.id}/disconnect`, {});
  ok("M2d", discon.status === 200, "and disconnect it, while they have no LifeOS access", discon.status);

  const ivy = await person("ivy");
  const clientI = crypto.randomUUID();
  await sys(ivy.individualId, [{ t: "lifeos_api_client", op: "insert", values: { id: clientI, name: `App I ${RUN}`, redirect_uris: [REDIRECT], allowed_scopes: ALL, status: "approved", provenance_source: "system" } }]);
  const ivyToken = await tokenFor(ivy.individualId, clientI, ALL.join(" "), ivy.personalWorkspaceId);
  for (const e of await store.where("lifeos_entitlement", { individual_id: ivy.individualId, status: "active" })) {
    await sys(ivy.individualId, [{ t: "lifeos_entitlement", op: "update", id: String(e.id), values: { status: "revoked", revoked_at: new Date().toISOString() } }]);
  }
  const refreshed = await tokenCall({ grant_type: "refresh_token", refresh_token: ivyToken.refresh_token, client_id: clientI });
  ok("M2b", refreshed.status === 400, "the app cannot refresh its way back", refreshed.status);
  await grantEntitlement(store, ivy.individualId, { individualId: ivy.individualId, source: "platform_grant", planCode: "boundary" });
  const revived = await call({ token: ivyToken.access_token }, "GET", "/me");
  ok("M2f", revived.status === 401, "and when the person comes back, the app has to ask again", revived.status);

  const erin = await person("erin");
  const clientE = crypto.randomUUID();
  await sys(erin.individualId, [{ t: "lifeos_api_client", op: "insert", values: { id: clientE, name: `App E ${RUN}`, redirect_uris: [REDIRECT], allowed_scopes: ALL, status: "approved", provenance_source: "system" } }]);
  const erinToken = await tokenFor(erin.individualId, clientE, ALL.join(" "), erin.personalWorkspaceId);
  await sys(erin.individualId, [{ t: "lifeos_api_client", op: "update", id: clientE, values: { status: "suspended" } }]);
  const suspendedRefresh = await tokenCall({ grant_type: "refresh_token", refresh_token: erinToken.refresh_token, client_id: clientE });
  ok("M2e", suspendedRefresh.status === 400, "a suspended app cannot refresh", suspendedRefresh.status);

  // ---- M3: a bearer token respects the identity link and the account ----
  const fay = await person("fay");
  const clientF = crypto.randomUUID();
  await sys(fay.individualId, [{ t: "lifeos_api_client", op: "insert", values: { id: clientF, name: `App F ${RUN}`, redirect_uris: [REDIRECT], allowed_scopes: ALL, status: "approved", provenance_source: "system" } }]);
  const fayToken = await tokenFor(fay.individualId, clientF, ALL.join(" "), fay.personalWorkspaceId);
  const [link] = await store.where("lifeos_identity_link", { individual_id: fay.individualId });
  await sys(fay.individualId, [{ t: "lifeos_identity_link", op: "update", id: String(link.id), values: { status: "revoked" } }]);
  const revokedLink = await call({ token: fayToken.access_token }, "GET", "/me");
  ok("M3a", revokedLink.status === 401, "revoking the identity link stops the token", revokedLink.status);
  const refreshLink = await tokenCall({ grant_type: "refresh_token", refresh_token: fayToken.refresh_token, client_id: clientF });
  ok("M3b", refreshLink.status === 400, "and refresh", refreshLink.status);

  const gus = await person("gus");
  const clientG = crypto.randomUUID();
  await sys(gus.individualId, [{ t: "lifeos_api_client", op: "insert", values: { id: clientG, name: `App G ${RUN}`, redirect_uris: [REDIRECT], allowed_scopes: ALL, status: "approved", provenance_source: "system" } }]);
  const gusToken = await tokenFor(gus.individualId, clientG, ALL.join(" "), gus.personalWorkspaceId);
  await admin.auth.admin.updateUserById(gus.subject, { ban_duration: "87600h" });
  const banned = await call({ token: gusToken.access_token }, "GET", "/me");
  ok("M3c", banned.status === 401, "a banned sign-in account stops the token", banned.status);

  // ---- Assumption from the review: paging keeps the privacy filter ----
  for (let i = 0; i < 5; i++) await call({ cookie: alice.cookie }, "POST", `${W}/commitments`, { title: `Alice page private ${RUN} ${i}` });
  for (let i = 0; i < 3; i++) await call({ cookie: bob.cookie }, "POST", `${W}/commitments`, { title: `Bob page ${RUN} ${i}` });
  let cursor: string | null = null;
  let seen = "";
  let pages = 0;
  do {
    const page: Res = await call({ cookie: bob.cookie }, "GET", `${W}/commitments?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    seen += page.text;
    cursor = page.body?.meta?.nextCursor ?? null;
    pages++;
  } while (cursor && pages < 40);
  ok("P1", pages >= 3 && !seen.includes("Alice page private") && !seen.includes(`Alice private ${RUN}`) && seen.includes(`Bob page ${RUN}`), "paging through a list never shows another member's private records", { pages });

  // ---- L1: re-joining does not revive old access (org side) ----
  const inviteHelen = await person("helen");
  await addMember(store, alice.individualId, org.workspaceId, inviteHelen.individualId, "member");
  const toHelen = await call({ cookie: alice.cookie }, "POST", `${W}/permission-grants`, { granteeIndividualId: inviteHelen.individualId, resourceType: "commitment", resourceId: alicePrivate.body.data.id, capability: "read" });
  const helenReads = await call({ cookie: inviteHelen.cookie }, "GET", `${W}/commitments/${alicePrivate.body.data.id}`);
  await call({ cookie: inviteHelen.cookie }, "POST", `${W}/leave`, {});
  const [helenMem] = await store.where("lifeos_membership", { workspace_id: org.workspaceId, individual_id: inviteHelen.individualId });
  await sys(alice.individualId, [{ t: "lifeos_membership", op: "update", id: String(helenMem.id), workspace_id: org.workspaceId, values: { status: "active" } }]);
  const helenBack = await call({ cookie: inviteHelen.cookie }, "GET", `${W}/commitments/${alicePrivate.body.data.id}`);
  ok("L1", toHelen.status === 201 && helenReads.status === 200 && helenBack.status === 404, "someone who leaves and comes back does not get their old access back", helenBack.status);

  // ---- M1: a token reaches the one workspace it was approved for ----
  const kim = await person("kim");
  const clientK = crypto.randomUUID();
  await sys(kim.individualId, [{ t: "lifeos_api_client", op: "insert", values: { id: clientK, name: `App K ${RUN}`, redirect_uris: [REDIRECT], allowed_scopes: ALL, status: "approved", provenance_source: "system" } }]);
  await addMember(store, alice.individualId, org.workspaceId, kim.individualId, "member");
  const KP = `/workspaces/${kim.personalWorkspaceId}`;
  await call({ cookie: kim.cookie }, "POST", `${KP}/commitments`, { title: `Kim personal ${RUN}` });
  await call({ cookie: kim.cookie }, "POST", `${W}/commitments`, { title: `Kim at work ${RUN}` });
  const workApp = await tokenFor(kim.individualId, clientK, ALL.join(" "), org.workspaceId);
  ok("B0", workApp.workspace_id === org.workspaceId, "the token response names the one workspace it reaches", workApp.workspace_id);
  const workReadsWork = await call({ token: workApp.access_token }, "GET", `${W}/commitments`);
  ok("B1", workReadsWork.status === 200 && workReadsWork.text.includes(`Kim at work ${RUN}`), "an app approved for work reads the person's records at work", workReadsWork.status);
  const workReadsHome = await call({ token: workApp.access_token }, "GET", `${KP}/commitments`);
  ok("B2", workReadsHome.status === 404 && !workReadsHome.text.includes(`Kim personal ${RUN}`), "an employer's app cannot read the person's personal commitments", workReadsHome.status);
  const workWritesHome = await call({ token: workApp.access_token }, "POST", `${KP}/commitments`, { title: "From a work app" });
  ok("B3", workWritesHome.status === 404, "nor write to their personal workspace", workWritesHome.status);
  const workList = await call({ token: workApp.access_token }, "GET", "/workspaces");
  ok("B4", workList.status === 200 && workList.body.data.length === 1 && workList.body.data[0].id === org.workspaceId, "nor learn that it exists from /workspaces", workList.body?.data?.length);
  const workMe = await call({ token: workApp.access_token }, "GET", "/me");
  ok("B5", workMe.status === 200 && workMe.body.data.workspaces.length === 1, "or from /me", workMe.body?.data?.workspaces?.length);
  const workRefreshed = await tokenCall({ grant_type: "refresh_token", refresh_token: workApp.refresh_token, client_id: clientK });
  const refreshedHome = await call({ token: workRefreshed.body?.access_token }, "GET", `${KP}/commitments`);
  ok("B6", workRefreshed.status === 200 && workRefreshed.body.workspace_id === org.workspaceId && refreshedHome.status === 404, "refreshing keeps the binding", [workRefreshed.status, refreshedHome.status]);
  const homeApp = await tokenFor(kim.individualId, clientK, ALL.join(" "), kim.personalWorkspaceId);
  const homeReadsHome = await call({ token: homeApp.access_token }, "GET", `${KP}/commitments`);
  const homeReadsWork = await call({ token: homeApp.access_token }, "GET", `${W}/commitments`);
  ok("B7", homeReadsHome.status === 200 && homeReadsWork.status === 404, "an app approved for the personal workspace cannot reach work either", [homeReadsHome.status, homeReadsWork.status]);
  const workStill = await call({ token: workRefreshed.body?.access_token }, "GET", `${W}/commitments`);
  ok("B8", workStill.status === 200, "one app can hold a separate approval for each workspace", workStill.status);
  const notMine = await tokenFor(kim.individualId, clientK, ALL.join(" "), dave.personalWorkspaceId).then(() => "issued", (e: any) => String(e.code ?? e));
  ok("B9", notMine === "not_found", "nobody can approve an app for a workspace they are not in", notMine);
  const workAgain = await tokenFor(kim.individualId, clientK, ALL.join(" "), org.workspaceId);
  const replaced = await call({ token: workRefreshed.body?.access_token }, "GET", `${W}/commitments`);
  const homeUntouched = await call({ token: homeApp.access_token }, "GET", `${KP}/commitments`);
  ok("B10", replaced.status === 401 && homeUntouched.status === 200, "approving again replaces only that workspace's approval", [replaced.status, homeUntouched.status]);
  const unbound = await sys(kim.individualId, [{ t: "lifeos_oauth_grant", op: "insert", values: { client_id: clientK, individual_id: kim.individualId, scopes: ["profile:read"], provenance_source: "system" } }]).then(() => "written", () => "refused");
  ok("B11", unbound === "refused", "the database refuses an active approval with no workspace", unbound);
  const outsider = await sys(kim.individualId, [{ t: "lifeos_oauth_grant", op: "insert", values: { client_id: clientK, individual_id: kim.individualId, bound_workspace_id: dave.personalWorkspaceId, scopes: ["profile:read"], provenance_source: "system" } }]).then(() => "written", () => "refused");
  ok("B12", outsider === "refused", "and one bound to a workspace the person has never been in", outsider);
  const [kimGrant] = await store.where("lifeos_oauth_grant", { individual_id: kim.individualId, client_id: clientK, status: "active", bound_workspace_id: org.workspaceId });
  const rebind = await sys(kim.individualId, [{ t: "lifeos_oauth_grant", op: "update", id: String(kimGrant.id), values: { bound_workspace_id: kim.personalWorkspaceId } }]).then(() => "written", () => "refused");
  ok("B13", rebind === "refused", "and moving an approval to another workspace", rebind);

  // ---- An organisation can end someone's access, and what the person approved for it ----
  const kimMembers = await call({ cookie: alice.cookie }, "GET", `${W}/members`);
  const kimMembership = String(kimMembers.body.data.find((m: any) => m.individualId === kim.individualId)?.id);
  const kimRemoved = await call({ cookie: alice.cookie }, "POST", `${W}/members/${kimMembership}/remove`, {});
  const afterRemoval = await call({ token: workAgain.access_token }, "GET", "/workspaces");
  const refreshAfterRemoval = await tokenCall({ grant_type: "refresh_token", refresh_token: workAgain.refresh_token, client_id: clientK });
  ok("B14", kimRemoved.status === 200 && afterRemoval.status === 401 && refreshAfterRemoval.status === 400, "removing someone ends the apps they approved for that workspace", [kimRemoved.status, afterRemoval.status, refreshAfterRemoval.status]);
  await sys(alice.individualId, [{ t: "lifeos_membership", op: "update", id: kimMembership, workspace_id: org.workspaceId, values: { status: "active" } }]);
  const backAgain = await call({ token: workAgain.access_token }, "GET", `${W}/commitments`);
  ok("B15", backAgain.status === 401, "and they do not return if the person comes back", backAgain.status);
  const homeSurvives = await call({ token: homeApp.access_token }, "GET", `${KP}/commitments`);
  ok("B16", homeSurvives.status === 200, "while an app approved for their personal workspace carries on", homeSurvives.status);

  const ivan = await person("ivan");
  const jo = await person("jo");
  await addMember(store, alice.individualId, org.workspaceId, ivan.individualId, "member");
  await addMember(store, alice.individualId, org.workspaceId, jo.individualId, "member");
  const toIvan = await call({ cookie: alice.cookie }, "POST", `${W}/permission-grants`, { granteeIndividualId: ivan.individualId, resourceType: "commitment", resourceId: alicePrivate.body.data.id, capability: "read" });
  const ivanPrivate = await call({ cookie: ivan.cookie }, "POST", `${W}/commitments`, { title: `Ivan private ${RUN}` });
  const ivanReads = await call({ cookie: ivan.cookie }, "GET", `${W}/commitments/${alicePrivate.body.data.id}`);
  ok("O0", toIvan.status === 201 && ivanReads.status === 200 && ivanPrivate.status === 201, "fixtures for removal are in place", [toIvan.status, ivanReads.status]);
  const members = await call({ cookie: alice.cookie }, "GET", `${W}/members`);
  const idOf = (who: string) => String(members.body.data.find((m: any) => m.individualId === who)?.id);
  const byMember = await call({ cookie: jo.cookie }, "POST", `${W}/members/${idOf(ivan.individualId)}/remove`, {});
  ok("O1", byMember.status === 403, "a member cannot remove anyone", byMember.status);
  const ofOwner = await call({ cookie: bob.cookie }, "POST", `${W}/members/${idOf(alice.individualId)}/remove`, {});
  ok("O2", ofOwner.status === 403, "nobody removes the owner", ofOwner.status);
  const removeToken = await tokenFor(alice.individualId, clientB, ALL.join(" "), org.workspaceId);
  const byApp = await call({ token: removeToken.access_token }, "POST", `${W}/members/${idOf(ivan.individualId)}/remove`, {});
  ok("O3", byApp.status === 403, "an app cannot remove anyone", byApp.status);
  const removed = await call({ cookie: bob.cookie }, "POST", `${W}/members/${idOf(ivan.individualId)}/remove`, {});
  ok("O4", removed.status === 200, "an admin can remove a member", removed.status);
  const ivanOut = await call({ cookie: ivan.cookie }, "GET", `${W}/commitments`);
  ok("O5", ivanOut.status === 404, "the person's access to that workspace ends at once", ivanOut.status);
  const ivanHome = await call({ cookie: ivan.cookie }, "GET", `/workspaces/${ivan.personalWorkspaceId}/commitments`);
  ok("O6", ivanHome.status === 200, "their personal workspace is untouched", ivanHome.status);
  const [ivanMem] = await store.where("lifeos_membership", { workspace_id: org.workspaceId, individual_id: ivan.individualId });
  await sys(alice.individualId, [{ t: "lifeos_membership", op: "update", id: String(ivanMem.id), workspace_id: org.workspaceId, values: { status: "active" } }]);
  const ivanBack = await call({ cookie: ivan.cookie }, "GET", `${W}/commitments/${alicePrivate.body.data.id}`);
  ok("O7", ivanBack.status === 404, "the access they were given does not return with them", ivanBack.status);
  const aliceCannot = await call({ cookie: alice.cookie }, "GET", `${W}/commitments/${ivanPrivate.body.data.id}`);
  ok("O8", aliceCannot.status === 404, "and removing someone reveals nothing of their private records", aliceCannot.status);

  await setFlag("lifeos_public_api", false);
  await setFlag("lifeos_core", false);
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map(f => `  - ${f}`).join("\n")); process.exit(1); }
}

main().catch(async e => {
  console.error(String(e).slice(0, 1200), e?.cause ?? "");
  console.error(String(e?.stack ?? "").slice(0, 800));
  await setFlag("lifeos_public_api", false);
  await setFlag("lifeos_core", false);
  process.exit(1);
});
