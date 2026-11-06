/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LIFEOS-API-001 delivery step 9: the public API, as a third-party app would use it. A real consent screen in Chromium,
 * real tokens over HTTP, on staging. It REFUSES anything but the staging project, turns the staging flags on for its run
 * and off at the end, and hard-deletes nothing.
 *
 *   LIFEOS_BASE_URL=http://localhost:3117 npx tsx scripts/lifeos-public-api-harness.ts
 */
import { createHash, randomBytes } from "node:crypto";
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
const REDIRECT = "http://localhost:9/callback";

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: unknown, msg: string, extra?: unknown) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}${extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 300)}` : ""}`); }
};
const setFlag = (flag: string, enabled: boolean) => admin.from("lifeos_flag").upsert({ flag, enabled, note: "staging public api harness", updated_at: new Date().toISOString() });

async function account(tag: string) {
  const email = `lifeos-api-${tag}-${RUN}@competen.test`;
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
  const p = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: data.user.id, displayName: `API ${tag}`, accessSource: "direct" });
  await grantEntitlement(store, p.individualId, { individualId: p.individualId, source: "platform_grant", planCode: "api-harness" });
  return { ...p, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}
const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
type Res = { status: number; body: any; text: string };
async function call(auth: { cookie?: string; token?: string }, method: string, path: string, body?: unknown): Promise<Res> {
  const write = method !== "GET";
  const headers: Record<string, string> = {};
  if (auth.cookie) headers.cookie = auth.cookie;
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  if (write) { headers["content-type"] = "application/json"; headers["idempotency-key"] = randomBytes(8).toString("hex"); }
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
const authorizeUrl = (clientId: string, challenge: string, scope: string, redirect = REDIRECT) => `${BASE}/lifeos/authorize?${new URLSearchParams({
  response_type: "code", client_id: clientId, redirect_uri: redirect, scope, state: `s-${RUN}`, code_challenge: challenge, code_challenge_method: "S256",
})}`;

async function main() {
  console.log(`LIFEOS PUBLIC API HARNESS -- target ${verdict.ok ? verdict.ref : "?"} via ${BASE} -- run ${RUN}\n`);
  await setFlag("lifeos_core", true);
  await setFlag("lifeos_public_api", false);
  const person = await account("person");
  const other = await account("other");
  const P = `/workspaces/${person.personalWorkspaceId}`;
  const secretTitle = `Private ${RUN}`;
  await call({ cookie: person.cookie }, "POST", `${P}/commitments`, { title: secretTitle });
  const otherOrg = await provisionOrganisation(store, other.individualId, { slug: `api-other-${RUN}`, name: "Other Org" });

  const clientId = crypto.randomUUID();
  const pendingId = crypto.randomUUID();
  const SCOPES = ["profile:read", "commitments:read", "commitments:write", "worlds:read"];
  await store.mutate({
    actor: person.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [
      { t: "lifeos_api_client", op: "insert", values: { id: clientId, name: `Test App ${RUN}`, redirect_uris: [REDIRECT], allowed_scopes: SCOPES, status: "approved", provenance_source: "system" } },
      { t: "lifeos_api_client", op: "insert", values: { id: pendingId, name: "Not Approved", redirect_uris: [REDIRECT], allowed_scopes: SCOPES, provenance_source: "system" } },
    ],
  });

  // ---- closed by default ----
  const offDoc = await fetch(`${API}/public/openapi.json`);
  ok("F1", offDoc.status === 404, "public flag off: the public document does not exist", offDoc.status);
  const offToken = await tokenCall({ grant_type: "refresh_token", refresh_token: "x", client_id: clientId });
  ok("F2", offToken.status === 404, "public flag off: the token endpoint does not exist", offToken.status);
  const offBearer = await call({ token: "lo_at_nothing" }, "GET", "/me");
  ok("F3", offBearer.status === 404, "public flag off: a bearer token gets not found", offBearer.status);
  await setFlag("lifeos_public_api", true);

  const doc = await (await fetch(`${API}/public/openapi.json`)).json() as any;
  ok("D1", !!doc.paths["/workspaces/{ws}/commitments"] && !!doc.components.securitySchemes.oauth && !JSON.stringify(doc.paths).includes("permission-grants"), "the public document lists approved capabilities only, and OAuth");

  // ---- consent, in a real browser ----
  const { verifier, challenge } = pkce();
  const browser = await chromium.launch();
  let code = "";
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    await ctx.addCookies(person.cookie.split("; ").map(c => { const i = c.indexOf("="); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
    const p = await ctx.newPage();
    for (const [id, target, why] of [
      ["C1", authorizeUrl(pendingId, challenge, "commitments:read"), "an app that is not approved"],
      ["C2", authorizeUrl(clientId, challenge, "commitments:read", "https://evil.example.org/steal"), "a return address that is not registered"],
      ["C3", authorizeUrl(clientId, challenge, "grants:write"), "a scope that does not exist"],
      ["C4", authorizeUrl(clientId, challenge, "schedules:read"), "a scope this app is not approved for"],
    ] as const) {
      const r = await p.goto(target, { timeout: 180000 });
      ok(id, r?.status() === 404, `the consent screen refuses ${why}`, r?.status());
    }
    await p.goto(authorizeUrl(clientId, challenge, "profile:read commitments:read worlds:read"), { timeout: 120000 });
    await p.getByRole("heading", { name: new RegExp(`Test App ${RUN} wants to connect`) }).waitFor({ timeout: 90000 });
    const shown = await p.textContent("main");
    ok("C5", shown?.includes("See your commitments") && !shown.includes("Add and change"), "the person sees what is being asked for, and only that");
    const before = (await admin.from("lifeos_oauth_grant").select("id").eq("individual_id", person.individualId)).data?.length;
    ok("C6", before === 0, "nothing is granted by showing the screen");

    const redirected = p.waitForRequest(r => r.url().startsWith(REDIRECT), { timeout: 60000 });
    await p.getByRole("button", { name: "Do not allow" }).click();
    const denied = new URL((await redirected).url());
    ok("C7", denied.searchParams.get("error") === "access_denied" && denied.searchParams.get("state") === `s-${RUN}` && !denied.searchParams.get("code"), "refusing returns no code", denied.search);
    await p.goto(authorizeUrl(clientId, challenge, "profile:read commitments:read worlds:read"), { timeout: 120000 });
    const redirected2 = p.waitForRequest(r => r.url().startsWith(REDIRECT), { timeout: 60000 });
    await p.getByRole("button", { name: "Allow", exact: true }).click();
    const got = new URL((await redirected2).url());
    code = got.searchParams.get("code") ?? "";
    ok("C8", code.length >= 40 && got.searchParams.get("state") === `s-${RUN}`, "allowing returns a code, and the app's state", got.search.slice(0, 40));

    // ---- exchange ----
    const stored = JSON.stringify((await admin.from("lifeos_oauth_code").select("*")).data);
    ok("X1", !stored.includes(code), "the code is stored only as a hash");
    const wrongVerifier = await tokenCall({ grant_type: "authorization_code", code, code_verifier: "x".repeat(50), client_id: clientId, redirect_uri: REDIRECT });
    ok("X2", wrongVerifier.status === 400 && wrongVerifier.body.error === "invalid_grant", "a stolen code is useless without the verifier", wrongVerifier.body);
    const wrongClient = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: pendingId, redirect_uri: REDIRECT });
    ok("X3", wrongClient.status === 400, "another client cannot use it", wrongClient.body);
    const wrongRedirect = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: "http://localhost:9/other" });
    ok("X4", wrongRedirect.status === 400, "nor at another return address", wrongRedirect.body);
    const [tok, race] = await Promise.all([
      tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }),
      tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }),
    ]);
    const winner = tok.status === 200 ? tok : race;
    ok("X5", [tok.status, race.status].sort().join() === "200,400" && winner.body.access_token.startsWith("lo_at_"), "two concurrent exchanges: one succeeds, because a code is single-use", [tok.status, race.status]);
    const access = winner.body.access_token as string;
    const refresh = winner.body.refresh_token as string;
    ok("X6", winner.body.scope === "profile:read commitments:read worlds:read" && winner.body.token_type === "Bearer", "the token states its scopes", winner.body.scope);
    const tokensStored = JSON.stringify((await admin.from("lifeos_oauth_token").select("*")).data);
    ok("X7", !tokensStored.includes(access) && !tokensStored.includes(refresh), "tokens are stored only as hashes");

    // ---- using it ----
    const me = await call({ token: access }, "GET", "/me");
    ok("U1", me.status === 200 && me.body.data.individual.id === person.individualId, "the app acts as the person who approved it", me.status);
    const list = await call({ token: access }, "GET", `${P}/commitments`);
    ok("U2", list.status === 200 && list.text.includes(secretTitle), "it reads the person's own records, with the scope they granted", list.status);
    const write = await call({ token: access }, "POST", `${P}/commitments`, { title: "From the app" });
    ok("U3", write.status === 403, "it cannot write without the write scope", write.status);
    const otherWs = await call({ token: access }, "GET", `/workspaces/${otherOrg.workspaceId}/commitments`);
    ok("U4", otherWs.status === 404, "it reaches nothing the person cannot reach", otherWs.status);
    for (const [method, path, body] of [
      ["GET", `${P}/goals`, undefined],
      ["GET", `${P}/permission-grants`, undefined],
      ["POST", `${P}/permission-grants`, {}],
      ["GET", `${P}/suggestions`, undefined],
      ["POST", `${P}/suggestions/generate`, {}],
      ["GET", `${P}/audit-events`, undefined],
      ["GET", "/tenants", undefined],
      ["GET", "/me/connected-apps", undefined],
      ["POST", "/oauth/authorize", {}],
    ] as const) {
      const r = await call({ token: access }, method, path, body);
      ok(`U5 ${method} ${path.replace(person.personalWorkspaceId, "ws")}`, r.status === 403, "off the approved list, even for a valid token", r.status);
    }
    const bad = await call({ token: "lo_at_madeup" }, "GET", "/me");
    ok("U6", bad.status === 401, "a made-up token is refused", bad.status);

    // ---- writing, with the write scope, and provenance ----
    const w = pkce();
    await p.goto(authorizeUrl(clientId, w.challenge, "profile:read commitments:read commitments:write"), { timeout: 120000 });
    const r3 = p.waitForRequest(r => r.url().startsWith(REDIRECT), { timeout: 60000 });
    await p.getByRole("button", { name: "Allow", exact: true }).click();
    const code2 = new URL((await r3).url()).searchParams.get("code") ?? "";
    const tok2 = await tokenCall({ grant_type: "authorization_code", code: code2, code_verifier: w.verifier, client_id: clientId, redirect_uri: REDIRECT });
    const superseded = await call({ token: access }, "GET", "/me");
    ok("W0", superseded.status === 401, "approving the app again replaces the earlier approval", superseded.status);
    const created = await call({ token: tok2.body.access_token }, "POST", `${P}/commitments`, { title: `From the app ${RUN}` });
    ok("W1", created.status === 201 && created.body.data.provenanceSource === "integration" && created.body.data.provenanceRef === clientId, "a write is marked as coming from this app", created.body?.data?.provenanceSource);
    const audit = await call({ cookie: person.cookie }, "GET", `${P}/audit-events?entityId=${created.body.data.id}`);
    ok("W2", audit.body.data[0]?.actorKind === "integration", "and the person's audit trail says so", audit.body.data[0]?.actorKind);
    const notifyOwner = await call({ cookie: person.cookie }, "GET", `${P}/commitments/${created.body.data.id}`);
    ok("W3", notifyOwner.status === 200 && notifyOwner.body.data.ownerIndividualId === person.individualId, "the person owns what the app created");

    // ---- refresh rotates, and replay ends it ----
    const rotated = await tokenCall({ grant_type: "refresh_token", refresh_token: tok2.body.refresh_token, client_id: clientId });
    ok("R1", rotated.status === 200 && rotated.body.refresh_token !== tok2.body.refresh_token, "refreshing rotates the token", rotated.status);
    const stillOld = await call({ token: tok2.body.access_token }, "GET", "/me");
    ok("R2", stillOld.status === 401, "the old access token ends with it", stillOld.status);
    const nu = await call({ token: rotated.body.access_token }, "GET", "/me");
    ok("R3", nu.status === 200, "the new one works", nu.status);
    const replay = await tokenCall({ grant_type: "refresh_token", refresh_token: tok2.body.refresh_token, client_id: clientId });
    ok("R4", replay.status === 400, "replaying a used refresh token is refused", replay.status);
    const afterReplay = await call({ token: rotated.body.access_token }, "GET", "/me");
    ok("R5", afterReplay.status === 401, "and it ends the whole approval, because it means a token was stolen", afterReplay.status);

    // ---- the person ends it ----
    const again = pkce();
    await p.goto(authorizeUrl(clientId, again.challenge, "commitments:read commitments:write"), { timeout: 120000 });
    const r5 = p.waitForRequest(r => r.url().startsWith(REDIRECT), { timeout: 60000 });
    await p.getByRole("button", { name: "Allow", exact: true }).click();
    const code4 = new URL((await r5).url()).searchParams.get("code") ?? "";
    const tok4 = await tokenCall({ grant_type: "authorization_code", code: code4, code_verifier: again.verifier, client_id: clientId, redirect_uri: REDIRECT });
    const apps = await call({ cookie: person.cookie }, "GET", "/me/connected-apps");
    const app = apps.body.data.find((a: any) => a.scopes.includes("commitments:write"));
    ok("P1", !!app && app.appName === `Test App ${RUN}`, "the person sees the app they connected", apps.body?.data?.length);
    const otherTries = await call({ cookie: other.cookie }, "POST", `/me/connected-apps/${app.id}/disconnect`, {});
    ok("P2", otherTries.status === 404, "nobody else can see or end it", otherTries.status);
    const disc = await call({ cookie: person.cookie }, "POST", `/me/connected-apps/${app.id}/disconnect`, {});
    const ended = await call({ token: tok4.body.access_token }, "GET", `${P}/commitments`);
    ok("P3", disc.status === 200 && ended.status === 401, "disconnecting ends its access at once", ended.status);
    await p.goto(`${BASE}/lifeos/connected`, { timeout: 120000 });
    await p.getByRole("heading", { name: "Connected apps", level: 2 }).waitFor({ timeout: 60000 });
    ok("P4", true, "the person has a Connected apps screen");

    // ---- the app, and the person, losing standing ----
    const s = pkce();
    await p.goto(authorizeUrl(clientId, s.challenge, "profile:read"), { timeout: 120000 });
    const r4 = p.waitForRequest(r => r.url().startsWith(REDIRECT), { timeout: 60000 });
    await p.getByRole("button", { name: "Allow", exact: true }).click();
    const code3 = new URL((await r4).url()).searchParams.get("code") ?? "";
    const tok3 = await tokenCall({ grant_type: "authorization_code", code: code3, code_verifier: s.verifier, client_id: clientId, redirect_uri: REDIRECT });
    const ents = await store.where("lifeos_entitlement", { individual_id: person.individualId, status: "active" });
    for (const e of ents) await store.mutate({ actor: person.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_entitlement", op: "update", id: String(e.id), values: { status: "revoked", revoked_at: new Date().toISOString() } }] });
    const noEnt = await call({ token: tok3.body.access_token }, "GET", "/me");
    ok("S1", noEnt.status === 401, "if the person loses LifeOS, the app's token stops working", noEnt.status);
    await grantEntitlement(store, person.individualId, { individualId: person.individualId, source: "platform_grant", planCode: "api-harness" });
    const c = (await store.get("lifeos_api_client", clientId)) as any;
    await store.mutate({ actor: person.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_api_client", op: "update", id: clientId, expected_version: c.version, values: { status: "suspended" } }] });
    const susp = await call({ token: tok3.body.access_token }, "GET", "/me");
    ok("S2", susp.status === 401, "suspending the app ends every token it holds", susp.status);
    const rev = await fetch(`${API}/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: "lo_at_unknown" }).toString() });
    ok("S3", rev.status === 200, "revoking an unknown token reveals nothing", rev.status);
  } finally {
    await browser.close();
  }

  await setFlag("lifeos_public_api", false);
  await setFlag("lifeos_core", false);
  const off = await fetch(`${API}/public/openapi.json`);
  ok("Z1", off.status === 404, "flags off again. Staging is left OFF", off.status);
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map(f => `  - ${f}`).join("\n")); process.exit(1); }
}

main().catch(async e => {
  console.error(String(e).slice(0, 1200));
  await setFlag("lifeos_public_api", false);
  await setFlag("lifeos_core", false);
  process.exit(1);
});
