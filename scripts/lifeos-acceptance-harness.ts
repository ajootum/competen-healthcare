/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LIFEOS-API-001: the Commitment Engine and API against the real staging database, over real HTTP, with real sessions.
 *
 *   npm run dev:staging                                  (a dev server pointed at staging, port 3100)
 *   npx tsx scripts/lifeos-acceptance-harness.ts         (or set LIFEOS_BASE_URL)
 *
 * It REFUSES anything but the staging project. It turns the staging gate on for its run and off again at the end.
 * Fixtures are additive: fixed test accounts, and a new organisation per run. It hard-deletes nothing.
 */
import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { supabaseStore } from "../src/lib/lifeos/adapters/supabase-store";
import { ISSUER_COMPETEN_AUTH, addMember, grantEntitlement, provisionIndividual, provisionOrganisation } from "../src/lib/lifeos/core/provision";
import { mondayOf, todayIn } from "../src/lib/lifeos/core/time";

loadEnvConfig(process.cwd());

const url = process.env.STAGING_SUPABASE_URL ?? "";
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.STAGING_ANON_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || verdict.ref !== "ezhvpgtcqcdsgylrxgdb" || !serviceKey || !anonKey) {
  console.error("REFUSING: this harness runs against the staging project only.");
  process.exit(1);
}
const BASE = process.env.LIFEOS_BASE_URL ?? "http://localhost:3100";
const API = `${BASE}/api/lifeos/v1`;

const admin: any = createClient(url, serviceKey, { auth: { persistSession: false } });
const store = supabaseStore(admin);

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: unknown, msg: string, extra?: unknown) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}${extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 400)}` : ""}`); }
};

const PASSWORD = randomBytes(24).toString("base64url");
const RUN = Date.now().toString(36);
const key = (() => { let n = 0; return () => `h-${RUN}-${++n}`; })();

async function ensureUser(email: string): Promise<string> {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const found = (list?.users ?? []).find((u: any) => u.email === email);
  if (found) {
    await admin.auth.admin.updateUserById(found.id, { password: PASSWORD, email_confirm: true });
    return found.id;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id;
}

/** A real session, carried as the cookies the server client reads. */
async function cookieFor(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const c = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (all: { name: string; value: string }[]) => { for (const { name, value } of all) jar.set(name, value); },
    },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

type Actor = { cookie: string | null };
type Res = { status: number; body: any; text: string; headers: Headers };

async function http(a: Actor, method: string, path: string, body?: unknown, opts: { key?: string; contentType?: string | null } = {}): Promise<Res> {
  const write = method !== "GET";
  const headers: Record<string, string> = {};
  if (a.cookie) headers.cookie = a.cookie;
  if (write) {
    const ct = opts.contentType === undefined ? "application/json" : opts.contentType;
    if (ct) headers["content-type"] = ct;
    if (opts.key !== "") headers["idempotency-key"] = opts.key ?? key();
  }
  const res = await fetch(`${API}${path}`, { method, headers, ...(write ? { body: JSON.stringify(body ?? {}) } : {}), redirect: "manual" });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text, headers: res.headers };
}

const setGate = async (enabled: boolean) => {
  const { error } = await admin.from("lifeos_flag").upsert({ flag: "lifeos_core", enabled, note: "staging harness", updated_at: new Date().toISOString() });
  if (error) throw new Error(`gate: ${error.message}`);
};

async function main() {
  console.log(`LIFEOS ACCEPTANCE HARNESS -- target ${verdict.ok ? verdict.ref : "?"} via ${BASE} -- run ${RUN}\n`);

  const email = (x: string) => `lifeos-harness-${x}@competen.test`;
  const subject = { a: await ensureUser(email("a")), b: await ensureUser(email("b")), c: await ensureUser(email("c")), d: await ensureUser(email("d")) };
  const A: Actor = { cookie: await cookieFor(email("a")) };
  const B: Actor = { cookie: await cookieFor(email("b")) };
  const C: Actor = { cookie: await cookieFor(email("c")) };
  const D: Actor = { cookie: await cookieFor(email("d")) };
  const ANON: Actor = { cookie: null };

  // ---- G. the gate ----
  await setGate(false);
  for (const [id, who, label] of [["G1", ANON, "signed out"], ["G2", A, "signed in"]] as const) {
    const r = await http(who, "GET", "/me");
    ok(id, r.status === 404 && r.text === "", `gate off: an empty 404 ${label}`, r);
  }
  const offWrite = await http(A, "POST", `/workspaces/${subject.a}/commitments`, { title: "x" });
  ok("G3", offWrite.status === 404 && offWrite.text === "", "gate off: a write is the same empty 404", offWrite);
  await setGate(true);
  const anon = await http(ANON, "GET", "/me");
  ok("G4", anon.status === 401 && anon.body?.error?.code === "unauthenticated" && !!anon.body?.error?.traceId, "gate on, signed out: 401 with a trace id", anon);
  const noLink = await http(D, "GET", "/me");
  ok("G5", noLink.status === 403, "a signed-in Competen person with no LifeOS link is refused, not provisioned", noLink);
  const dLinks = await store.where("lifeos_identity_link", { issuer: ISSUER_COMPETEN_AUTH, subject: subject.d });
  ok("G6", dLinks.length === 0, "...and asking created nothing for them");

  // ---- Provisioning ----
  const pa = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: subject.a, displayName: "Harness A", accessSource: "platform_grant", timezone: "Africa/Kampala" });
  const pb = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: subject.b, displayName: "Harness B", accessSource: "platform_grant" });
  const pc = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: subject.c, displayName: "Harness C", accessSource: "platform_grant" });
  const again = await provisionIndividual(store, { issuer: ISSUER_COMPETEN_AUTH, subject: subject.a, displayName: "Harness A", accessSource: "platform_grant" });
  ok("P1", again.individualId === pa.individualId && !again.created, "provisioning twice returns the same person");
  ok("P2", pa.individualId !== subject.a, "the LifeOS id is not the auth id, so a carve-out keeps it stable");
  await admin.from("lifeos_rate_window").update({ hits: 0 }).in("subject", [pa.individualId, pb.individualId, pc.individualId]);

  // ---- H. the entitlement admits, the identity link alone does not ----
  // The fixture accounts persist across runs, so any earlier entitlements are ended first (by update, not delete).
  for (const id of [pa.individualId, pb.individualId, pc.individualId]) {
    for (const row of await store.where("lifeos_entitlement", { individual_id: id, status: "active" })) {
      await store.mutate({ actor: id, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_entitlement", op: "update", id: String(row.id), values: { status: "revoked", revoked_at: new Date().toISOString() } }] });
    }
  }
  const noEnt = await http(A, "GET", "/me");
  ok("H1", noEnt.status === 403, "a person with an identity link but no live entitlement is refused", noEnt);
  await grantEntitlement(store, pa.individualId, { individualId: pa.individualId, source: "direct", endsAt: "2020-01-01T00:00:00Z" }).then(
    () => ok("H2a", false, "an entitlement that ended before it started is refused"),
    () => ok("H2a", true, "an entitlement that ended before it started is refused"),
  );
  const past = new Date(Date.now() + 6000).toISOString();
  const shortId = await grantEntitlement(store, pa.individualId, { individualId: pa.individualId, source: "direct", endsAt: past });
  await new Promise(r => setTimeout(r, 8000));
  const lapsed = await http(A, "GET", "/me");
  ok("H2", lapsed.status === 403, "an entitlement that has lapsed admits nobody, judged by the database clock", lapsed);
  const liveId = await grantEntitlement(store, pa.individualId, { individualId: pa.individualId, source: "platform_grant", planCode: "harness" });
  const admitted = await http(A, "GET", "/me");
  ok("H3", admitted.status === 200 && admitted.body.data.entitlements.length === 1 && admitted.body.data.entitlements[0].id === liveId, "a live entitlement admits, and /me shows only what is live", admitted.status);
  ok("H3b", !admitted.body.data.entitlements.some((e: any) => e.id === shortId), "...and the lapsed one is not shown");
  await store.mutate({ actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_entitlement", op: "update", id: liveId, values: { status: "revoked", revoked_at: new Date().toISOString() } }] });
  const revokedEnt = await http(A, "GET", "/me");
  ok("H4", revokedEnt.status === 403, "revoking it ends access at once", revokedEnt);
  const noTenant = await store.mutate({
    actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_entitlement", op: "insert", values: { individual_id: pa.individualId, source: "organisation", provenance_source: "system" } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("H5", noTenant === "validation_failed", "organisation access must name its organisation, at the database", noTenant);
  const noProv = await store.mutate({
    actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_entitlement", op: "insert", values: { individual_id: pa.individualId, source: "direct" } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("H6", noProv !== "committed", "access cannot be written without saying where it came from", noProv);
  for (const id of [pa.individualId, pb.individualId, pc.individualId]) await grantEntitlement(store, id, { individualId: id, source: "platform_grant", planCode: "harness" });

  const org = await provisionOrganisation(store, pa.individualId, { slug: `harness-w-${RUN}`, name: "Harness Hospital" });
  const other = await provisionOrganisation(store, pa.individualId, { slug: `harness-x-${RUN}`, name: "Harness Other Org" });
  await addMember(store, pa.individualId, org.workspaceId, pb.individualId, "member");
  await addMember(store, pa.individualId, org.workspaceId, pc.individualId, "admin");
  const W = `/workspaces/${org.workspaceId}`;
  const X = `/workspaces/${other.workspaceId}`;
  const P = `/workspaces/${pa.personalWorkspaceId}`;

  const me = await http(A, "GET", "/me");
  ok("M1", me.status === 200 && me.body.data.individual.id === pa.individualId, "GET /me returns the person", me);
  const wsKinds = me.body.data.workspaces.map((w: any) => w.kind).sort();
  ok("M2", wsKinds.includes("personal") && wsKinds.includes("organisation"), "...and both personal and organisation workspaces");
  const doc = await http(A, "GET", "/openapi.json");
  ok("M3", doc.status === 200 && doc.body.data.openapi === "3.1.0" && !!doc.body.data.paths["/workspaces/{ws}/commitments"], "the OpenAPI document is served", doc.status);
  ok("M4", !doc.text.includes("credentialRef"), "...and it does not mention a credential reference");

  // ---- E. the engine, as the prototype's journey ----
  const world = await http(A, "POST", `${W}/worlds`, { title: "Hospital leadership", context: "Hospital", purpose: "Patient safety" });
  ok("E1", world.status === 201 && world.body.data.accessScope === "private", "a world is created, private by default", world);
  const worldId = world.body.data.id;
  const SECRET = `Confidential ${RUN}`;
  const cap = await http(A, "POST", `${W}/commitments`, { title: SECRET });
  ok("E2", cap.status === 201 && cap.body.data.status === "inbox" && cap.body.data.quadrant === null, "capture: inbox, with no quadrant yet", cap);
  let c = cap.body.data;
  const notClarified = await http(A, "POST", `${W}/commitments/${c.id}/transition`, { to: "in_progress", expectedVersion: c.version });
  ok("E3", notClarified.status === 422 && notClarified.body.error.code === "invalid_transition", "an unclarified commitment cannot start", notClarified);
  const clar = await http(A, "PATCH", `${W}/commitments/${c.id}`, { expectedVersion: c.version, worldId, important: true, urgent: false });
  ok("E4", clar.status === 200 && clar.body.data.quadrant === "q2", "clarified: the quadrant is calculated as q2", clar);
  c = clar.body.data;
  const reclass = await http(A, "PATCH", `${W}/commitments/${c.id}`, { expectedVersion: c.version, urgent: true });
  ok("E5", reclass.body.data.quadrant === "q1", "changing urgency recalculates it as q1", reclass);
  c = reclass.body.data;
  const log = await http(A, "GET", `${W}/quadrant-classifications?commitmentId=${c.id}`);
  ok("E6", log.status === 200 && log.body.data.length === 2 && log.body.data.map((q: any) => q.quadrant).join() === "q2,q1", "each classification change is logged, by trigger", log);
  const setStatus = await http(A, "PATCH", `${W}/commitments/${c.id}`, { expectedVersion: c.version, status: "done" });
  ok("E7", setStatus.status === 422, "PATCH cannot set a status", setStatus);
  const setOwner = await http(A, "PATCH", `${W}/commitments/${c.id}`, { expectedVersion: c.version, ownerIndividualId: pb.individualId });
  ok("E8", setOwner.status === 422, "PATCH cannot change the owner", setOwner);
  const setQuad = await http(A, "PATCH", `${W}/commitments/${c.id}`, { expectedVersion: c.version, quadrant: "q4" });
  ok("E9", setQuad.status === 422, "PATCH cannot assign a quadrant", setQuad);
  const today = todayIn("Africa/Kampala");
  const noDate = await http(A, "POST", `${W}/commitments/${c.id}/transition`, { to: "planned", expectedVersion: c.version });
  ok("E10", noDate.status === 422, "planning needs a date", noDate);
  const planned = await http(A, "POST", `${W}/commitments/${c.id}/transition`, { to: "planned", expectedVersion: c.version, scheduledOn: today, scheduledTime: "09:00" });
  ok("E11", planned.status === 200 && planned.body.data.status === "planned" && planned.body.data.scheduledOn === today, "planned, with a date", planned);
  c = planned.body.data;
  const started = await http(A, "POST", `${W}/commitments/${c.id}/transition`, { to: "in_progress", expectedVersion: c.version });
  c = started.body.data;
  const done = await http(A, "POST", `${W}/commitments/${c.id}/transition`, { to: "done", expectedVersion: c.version });
  ok("E12", done.body.data?.status === "done" && !!done.body.data?.completedAt, "started, then done, with a completion time", done);
  c = done.body.data;
  const reopened = await http(A, "POST", `${W}/commitments/${c.id}/transition`, { to: "planned", expectedVersion: c.version });
  ok("E13", reopened.body.data?.status === "planned" && reopened.body.data?.completedAt === null, "reopened, and the completion time is cleared", reopened);
  c = reopened.body.data;
  const illegal = await http(A, "POST", `${W}/commitments/${c.id}/transition`, { to: "delegated", expectedVersion: c.version });
  ok("E14", illegal.status === 422 && illegal.body.error.code === "invalid_transition", "delegated cannot be reached by a transition", illegal);
  const stale = await http(A, "PATCH", `${W}/commitments/${c.id}`, { expectedVersion: 1, title: "Overwrite" });
  ok("E15", stale.status === 409 && stale.body.error.code === "version_conflict", "a stale write is refused, so an edit cannot be silently lost", stale);
  const monday = mondayOf(today);
  const notMonday = await http(A, "POST", `${W}/weekly-plans`, { weekStart: today === monday ? `${today.slice(0, 8)}${String(Number(today.slice(8)) + 1).padStart(2, "0")}` : today });
  ok("E16", notMonday.status === 422, "a weekly plan must start on a Monday", notMonday);

  // Archive is soft and reversible
  const arch = await http(A, "POST", `${W}/worlds`, { title: "To archive" });
  const archived = await http(A, "POST", `${W}/worlds/${arch.body.data.id}/archive`, { expectedVersion: 1 });
  ok("E17", !!archived.body.data?.archivedAt, "archive is a soft removal", archived);
  const listNoArch = await http(A, "GET", `${W}/worlds`);
  ok("E18", !listNoArch.body.data.some((w: any) => w.id === arch.body.data.id), "an archived record leaves the list");
  const listArch = await http(A, "GET", `${W}/worlds?includeArchived=true`);
  ok("E19", listArch.body.data.some((w: any) => w.id === arch.body.data.id), "...and is still there when asked for");
  const editArch = await http(A, "PATCH", `${W}/worlds/${arch.body.data.id}`, { expectedVersion: archived.body.data.version, title: "x" });
  ok("E20", editArch.status === 409, "an archived record cannot be edited until restored", editArch);
  const restored = await http(A, "POST", `${W}/worlds/${arch.body.data.id}/restore`, { expectedVersion: archived.body.data.version });
  ok("E21", restored.body.data?.archivedAt === null, "restore brings it back", restored);

  // ---- I. idempotency ----
  const k1 = key();
  const first = await http(A, "POST", `${W}/goals`, { title: "One goal" }, { key: k1 });
  const second = await http(A, "POST", `${W}/goals`, { title: "One goal" }, { key: k1 });
  ok("I1", first.status === 201 && second.status === 200 && second.body.meta.replayed === true && second.body.data.id === first.body.data.id, "a retry returns the first record, marked replayed", second);
  const reused = await http(A, "POST", `${W}/goals`, { title: "A different goal" }, { key: k1 });
  ok("I2", reused.status === 409 && reused.body.error.code === "idempotency_key_reused", "the same key with a different body is refused", reused);
  const reusedPath = await http(A, "POST", `${W}/projects`, { title: "One goal" }, { key: k1 });
  ok("I3", reusedPath.status === 409, "the same key on a different endpoint is refused", reusedPath);
  const k2 = key();
  const burst = await Promise.all(Array.from({ length: 6 }, () => http(A, "POST", `${W}/goals`, { title: `Burst ${RUN}` }, { key: k2 })));
  const burstIds = new Set(burst.map(b => b.body?.data?.id));
  ok("I4", burstIds.size === 1 && !burstIds.has(undefined), "six concurrent retries make one record", burst.map(b => b.status));
  const burstRows = await store.where("lifeos_goal", { workspace_id: org.workspaceId, title: `Burst ${RUN}` });
  ok("I5", burstRows.length === 1, "...and the database holds exactly one");
  const k3 = key();
  const t1 = await http(A, "POST", `${W}/commitments/${c.id}/transition`, { to: "in_progress", expectedVersion: c.version }, { key: k3 });
  const t2 = await http(A, "POST", `${W}/commitments/${c.id}/transition`, { to: "in_progress", expectedVersion: c.version }, { key: k3 });
  ok("I6", t1.status === 200 && t2.status === 200 && t2.body.meta.replayed === true && t2.body.data.version === t1.body.data.version, "a retried transition replays, rather than failing or moving twice", t2);
  c = t1.body.data;
  const noKey = await http(A, "POST", `${W}/goals`, { title: "x" }, { key: "" });
  ok("I7", noKey.status === 422, "a write with no Idempotency-Key is refused", noKey);
  const plainText = await http(A, "POST", `${W}/goals`, { title: "x" }, { contentType: "text/plain" });
  ok("I8", plainText.status === 422, "a write that is not application/json is refused", plainText);

  // A failed batch leaves nothing behind, including its key.
  const k4 = key();
  const badBatch = await store.mutate({
    actor: pa.individualId, actorKind: "user", idempotencyKey: k4, requestHash: "h", traceId: null,
    ops: [
      { t: "lifeos_goal", op: "insert", values: { workspace_id: org.workspaceId, owner_individual_id: pa.individualId, title: `Atomic ${RUN}`, provenance_source: "user" } },
      { t: "lifeos_goal", op: "insert", values: { workspace_id: org.workspaceId, owner_individual_id: pa.individualId, title: "", provenance_source: "user" } },
    ],
  }).then(() => "committed", (e: any) => e.code);
  const atomicRows = await store.where("lifeos_goal", { workspace_id: org.workspaceId, title: `Atomic ${RUN}` });
  const atomicKey = await store.peekIdempotency(pa.individualId, k4);
  ok("I9", badBatch === "validation_failed" && atomicRows.length === 0 && atomicKey === null, "a batch that fails leaves neither a row nor a key", { badBatch, n: atomicRows.length });

  // ---- L. lists ----
  const listed = await Promise.all([1, 2, 3].map(n => http(A, "POST", `${W}/projects`, { title: `Page ${RUN} ${n}` })));
  ok("L0", listed.every(l => l.status === 201), "three projects created", listed.map(l => l.status));
  const page1 = await http(A, "GET", `${W}/projects?limit=2`);
  const page2 = await http(A, "GET", `${W}/projects?limit=2&cursor=${page1.body.meta.nextCursor}`);
  const ids = [...page1.body.data, ...page2.body.data].map((p: any) => p.id);
  ok("L1", page1.body.data.length === 2 && !!page1.body.meta.nextCursor && page2.body.data.length >= 1 && new Set(ids).size === ids.length, "a cursor pages without repeating", { a: page1.status, b: page2.status });
  const badCursor = await http(A, "GET", `${W}/projects?cursor=not-a-cursor`);
  ok("L2", badCursor.status === 422, "a bad cursor is refused", badCursor);
  const injected = Buffer.from(JSON.stringify({ at: 'now",credential_ref.like.a*,created_at.eq."2026-01-01', id: pa.individualId })).toString("base64url");
  const badInjected = await http(A, "GET", `${W}/integration-connections?cursor=${injected}`);
  ok("L2b", badInjected.status === 422, "a cursor carrying a filter expression is refused", badInjected);
  const badLimit = await http(A, "GET", `${W}/projects?limit=9999`);
  ok("L3", badLimit.status === 422, "a limit over 200 is refused", badLimit);
  const unknownFilter = await http(A, "GET", `${W}/projects?owner=me`);
  ok("L4", unknownFilter.status === 422, "an unknown filter is refused", unknownFilter);
  const byStatus = await http(A, "GET", `${W}/commitments?status=in_progress`);
  ok("L5", byStatus.body.data.length >= 1 && byStatus.body.data.every((x: any) => x.status === "in_progress"), "filter by status", byStatus.status);
  const byQuad = await http(A, "GET", `${W}/commitments?quadrant=q1`);
  ok("L6", byQuad.body.data.every((x: any) => x.quadrant === "q1"), "filter by quadrant", byQuad.status);

  // ---- A. access: the private record ----
  const bReads = await http(B, "GET", `${W}/commitments/${c.id}`);
  ok("A1", bReads.status === 404, "another member cannot read a private commitment, and is told it does not exist", bReads);
  const bList = await http(B, "GET", `${W}/commitments`);
  ok("A2", bList.status === 200 && !bList.text.includes(SECRET), "...and it is not in their list", bList.status);
  const cReads = await http(C, "GET", `${W}/commitments/${c.id}`);
  ok("A3", cReads.status === 404, "an organisation ADMIN cannot read a member's private commitment", cReads);
  const cList = await http(C, "GET", `${W}/commitments`);
  ok("A4", !cList.text.includes(SECRET), "...nor list it", cList.status);
  const bLog = await http(B, "GET", `${W}/quadrant-classifications?commitmentId=${c.id}`);
  ok("A5", bLog.status === 200 && bLog.body.data.length === 0, "its classification history is private too", bLog);
  const bAudit = await http(B, "GET", `${W}/audit-events?entityId=${c.id}`);
  ok("A6", bAudit.status === 200 && bAudit.body.data.length === 0, "its audit trail is private too", bAudit);
  const bWrite = await http(B, "PATCH", `${W}/commitments/${c.id}`, { expectedVersion: c.version, title: "Hijack" });
  ok("A7", bWrite.status === 404, "another member cannot write it", bWrite);

  // Workspace scope
  const shared = await http(A, "POST", `${W}/worlds`, { title: `Shared ${RUN}`, accessScope: "workspace" });
  const sid = shared.body.data.id;
  const bShared = await http(B, "GET", `${W}/worlds/${sid}`);
  ok("A8", bShared.status === 200, "a workspace-scope record can be read by a member", bShared);
  const bSharedWrite = await http(B, "PATCH", `${W}/worlds/${sid}`, { expectedVersion: 1, title: "x" });
  ok("A9", bSharedWrite.status === 403, "...but not changed by one", bSharedWrite);
  const cSharedWrite = await http(C, "PATCH", `${W}/worlds/${sid}`, { expectedVersion: 1, title: `Shared edited ${RUN}` });
  ok("A10", cSharedWrite.status === 200, "...and can be changed by an admin", cSharedWrite);

  // A private world is not usable by someone else, though it is in the same workspace
  const bUses = await http(B, "POST", `${W}/commitments`, { title: "Uses private world", worldId });
  ok("A11", bUses.status === 422, "a member cannot attach their record to another person's private world", bUses);

  // Grants
  const grant = await http(A, "POST", `${W}/permission-grants`, { granteeIndividualId: pb.individualId, resourceType: "commitment", resourceId: c.id, capability: "read" });
  ok("A12", grant.status === 201, "the owner grants read on one commitment", grant);
  const bGranted = await http(B, "GET", `${W}/commitments/${c.id}`);
  ok("A13", bGranted.status === 200 && bGranted.body.data.title === SECRET, "...and the grantee can read it", bGranted.status);
  const bGrantedWrite = await http(B, "PATCH", `${W}/commitments/${c.id}`, { expectedVersion: c.version, title: "Hijack" });
  ok("A14", bGrantedWrite.status === 403, "...but a read grant does not write", bGrantedWrite);
  const cStill = await http(C, "GET", `${W}/commitments/${c.id}`);
  ok("A15", cStill.status === 404, "...and the grant reaches nobody else, not even an admin", cStill);
  const bForge = await http(B, "POST", `${W}/permission-grants`, { granteeIndividualId: pc.individualId, resourceType: "commitment", resourceId: c.id, capability: "read" });
  ok("A16", bForge.status === 422, "a grantee cannot pass the access on", bForge);
  const bGrantList = await http(B, "GET", `${W}/permission-grants`);
  ok("A17", bGrantList.body.data.some((g: any) => g.id === grant.body.data.id), "a grantee can see a grant made to them");
  const bRevoke = await http(B, "POST", `${W}/permission-grants/${grant.body.data.id}/transition`, { to: "revoked", expectedVersion: 1 });
  ok("A18", bRevoke.status === 403, "...but not revoke it", bRevoke);
  const revoke = await http(A, "POST", `${W}/permission-grants/${grant.body.data.id}/transition`, { to: "revoked", expectedVersion: 1 });
  ok("A19", revoke.body.data?.status === "revoked", "the owner revokes it", revoke);
  const bRevoked = await http(B, "GET", `${W}/commitments/${c.id}`);
  ok("A20", bRevoked.status === 404, "...and access ends at once", bRevoked);

  const expired = await http(A, "POST", `${W}/permission-grants`, { granteeIndividualId: pb.individualId, resourceType: "commitment", resourceId: c.id, capability: "read", expiresAt: "2020-01-01T00:00:00Z" });
  ok("A21", expired.status === 201, "a grant with a past expiry can be recorded", expired);
  const bExpired = await http(B, "GET", `${W}/commitments/${c.id}`);
  ok("A22", bExpired.status === 404, "...and it grants nothing, judged by the database clock", bExpired);
  const future = await http(A, "POST", `${W}/permission-grants`, { granteeIndividualId: pb.individualId, resourceType: "commitment", resourceId: c.id, capability: "write", expiresAt: "2099-01-01T00:00:00Z" });
  const replayKey = key();
  const replayBody = { expectedVersion: c.version, notes: "Edited by grantee" };
  const bFuture = await http(B, "PATCH", `${W}/commitments/${c.id}`, replayBody, { key: replayKey });
  ok("A23", future.status === 201 && bFuture.status === 200 && bFuture.body.data.ownerIndividualId === pa.individualId, "a live write grant writes, and the owner does not change", bFuture);
  c = bFuture.body.data;
  const bScope = await http(B, "PATCH", `${W}/commitments/${c.id}`, { expectedVersion: c.version, accessScope: "workspace" });
  ok("A23b", bScope.status === 403, "a write grant cannot widen who can see the owner's record", bScope);
  const bReplayLive = await http(B, "PATCH", `${W}/commitments/${c.id}`, replayBody, { key: replayKey });
  ok("A23c", bReplayLive.status === 200 && bReplayLive.body.meta.replayed === true, "while the grant is live, a retry replays", bReplayLive.status);
  await http(A, "POST", `${W}/permission-grants/${future.body.data.id}/transition`, { to: "revoked", expectedVersion: 1 });
  const bReplayGone = await http(B, "PATCH", `${W}/commitments/${c.id}`, replayBody, { key: replayKey });
  ok("A23d", bReplayGone.status === 404 && !bReplayGone.text.includes(SECRET), "after the grant is revoked, the same retry reveals nothing", bReplayGone);
  const typeGrant = await http(A, "POST", `${W}/permission-grants`, { granteeIndividualId: pc.individualId, resourceType: "world", capability: "read" });
  const cWorld = await http(C, "GET", `${W}/worlds/${worldId}`);
  const cGoal = await http(C, "GET", `${W}/goals/${first.body.data.id}`);
  ok("A24", typeGrant.status === 201 && cWorld.status === 200 && cGoal.status === 404, "a type-wide grant reaches that type, and only that type", { cWorld: cWorld.status, cGoal: cGoal.status });
  await http(A, "POST", `${W}/permission-grants/${typeGrant.body.data.id}/transition`, { to: "revoked", expectedVersion: 1 });

  // ---- X. nothing crosses organisations ----
  const otherWorld = await http(A, "POST", `${X}/worlds`, { title: "Other org world" });
  const otherCommit = await http(A, "POST", `${X}/commitments`, { title: `Other org ${RUN}` });
  ok("X0", otherWorld.status === 201 && otherCommit.status === 201, "the second organisation has records", [otherWorld.status, otherCommit.status]);
  const bX = await http(B, "GET", X);
  ok("X1", bX.status === 404, "a non-member cannot see the other organisation's workspace exists", bX);
  const bXc = await http(B, "GET", `${X}/commitments/${otherCommit.body.data.id}`);
  ok("X2", bXc.status === 404, "...nor read its commitment", bXc);
  const crossPath = await http(A, "GET", `${W}/commitments/${otherCommit.body.data.id}`);
  ok("X3", crossPath.status === 404, "even a member of both cannot read one workspace's record through the other", crossPath);
  const crossRef = await http(A, "POST", `${W}/commitments`, { title: "Cross ref", worldId: otherWorld.body.data.id });
  ok("X4", crossRef.status === 422, "the API refuses a reference to another organisation's world", crossRef);
  const crossDb = await store.mutate({
    actor: pa.individualId, actorKind: "user", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_commitment", op: "insert", values: { workspace_id: org.workspaceId, owner_individual_id: pa.individualId, world_id: otherWorld.body.data.id, title: "Cross", provenance_source: "user" } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("X5", crossDb === "validation_failed", "...and the DATABASE refuses it too, if a writer skips the service", crossDb);
  const crossOwner = await store.mutate({
    actor: pa.individualId, actorKind: "user", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_commitment", op: "insert", values: { workspace_id: other.workspaceId, owner_individual_id: pb.individualId, title: "Foreign owner", provenance_source: "user" } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("X6", crossOwner === "validation_failed", "a non-member cannot own a record in a workspace, at the database", crossOwner);
  const moveWs = await store.mutate({
    actor: pa.individualId, actorKind: "user", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_commitment", op: "update", id: c.id, workspace_id: org.workspaceId, values: { workspace_id: other.workspaceId } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("X7", moveWs === "validation_failed", "a record cannot be moved to another workspace", moveWs);
  const intoPersonal = await store.mutate({
    actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_membership", op: "insert", values: { workspace_id: pa.personalWorkspaceId, individual_id: pb.individualId, role: "member", provenance_source: "system" } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("X8", intoPersonal === "validation_failed", "nobody can be added to someone else's personal workspace, at the database", intoPersonal);
  const secondPersonal = await store.mutate({
    actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_workspace", op: "insert", values: { owner_individual_id: pa.individualId, kind: "personal", name: "Second", provenance_source: "system" } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("X9", secondPersonal === "conflict", "one personal workspace per person, at the database", secondPersonal);

  // ---- D. delegation ----
  const dc = await http(A, "POST", `${W}/commitments`, { title: `Delegated ${RUN}`, worldId, important: true, urgent: false, scheduledOn: today });
  ok("D0", dc.body.data?.status === "planned", "a fully clarified, dated capture is planned straight away", dc);
  const raw = await http(A, "POST", `${W}/commitments`, { title: "Raw" });
  const rawDel = await http(A, "POST", `${W}/delegations`, { commitmentId: raw.body.data.id, delegateeLabel: "Someone", followUpOn: today });
  ok("D1", rawDel.status === 422, "an unclarified commitment cannot be delegated", rawDel);
  const noFollow = await http(A, "POST", `${W}/delegations`, { commitmentId: dc.body.data.id, delegateeLabel: "Someone" });
  ok("D2", noFollow.status === 422, "a delegation needs a follow-up date", noFollow);
  const bDel = await http(B, "POST", `${W}/delegations`, { commitmentId: dc.body.data.id, delegateeLabel: "Someone", followUpOn: today });
  ok("D3", bDel.status === 404, "someone who cannot read a commitment cannot delegate it", bDel);
  const del = await http(A, "POST", `${W}/delegations`, { commitmentId: dc.body.data.id, delegateeIndividualId: pb.individualId, followUpOn: today, expectations: "Close the loop" });
  ok("D4", del.status === 201, "the owner delegates to a member", del);
  const archDel = await http(A, "POST", `${W}/delegations/${del.body.data.id}/archive`, { expectedVersion: 1 });
  ok("D4b", archDel.status === 409, "an active delegation is closed, not archived, so its grants cannot be left open", archDel);
  const afterDel = await http(A, "GET", `${W}/commitments/${dc.body.data.id}`);
  ok("D5", afterDel.body.data.status === "delegated" && afterDel.body.data.ownerIndividualId === pa.individualId, "the commitment is delegated, and ownership stays", afterDel.body.data?.status);
  const bSees = await http(B, "GET", `${W}/commitments/${dc.body.data.id}`);
  const bSeesDel = await http(B, "GET", `${W}/delegations/${del.body.data.id}`);
  ok("D6", bSees.status === 200 && bSeesDel.status === 200, "the delegatee can read the commitment and the delegation", [bSees.status, bSeesDel.status]);
  const bSeesOther = await http(B, "GET", `${W}/commitments/${c.id}`);
  ok("D7", bSeesOther.status === 404, "...and nothing else of the owner's", bSeesOther);
  const bCloses = await http(B, "POST", `${W}/delegations/${del.body.data.id}/transition`, { to: "completed", expectedVersion: 1 });
  ok("D8", bCloses.status === 403, "the delegatee cannot close it: follow-through stays with the owner", bCloses);
  const dup = await http(A, "POST", `${W}/delegations`, { commitmentId: dc.body.data.id, delegateeLabel: "Second", followUpOn: today });
  ok("D9", dup.status === 422, "an already delegated commitment cannot be delegated again", dup);
  const dupDb = await store.mutate({
    actor: pa.individualId, actorKind: "user", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_delegation", op: "insert", values: { workspace_id: org.workspaceId, owner_individual_id: pa.individualId, commitment_id: dc.body.data.id, delegatee_label: "Second", follow_up_on: today, provenance_source: "user" } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("D10", dupDb === "conflict", "...and the database holds one active delegation per commitment", dupDb);
  const stranger = await http(A, "POST", `${W}/commitments`, { title: "To stranger", worldId, important: true, urgent: false });
  const toStranger = await http(A, "POST", `${P}/delegations`, { commitmentId: stranger.body.data.id, delegateeLabel: "x", followUpOn: today });
  ok("D11", toStranger.status === 404, "a commitment cannot be delegated through another workspace", toStranger);
  const personalWorld = await http(A, "POST", `${P}/worlds`, { title: `Family ${RUN}` });
  const personalC = await http(A, "POST", `${P}/commitments`, { title: `Family dinner ${RUN}`, worldId: personalWorld.body.data.id, important: true, urgent: false });
  const fromPersonal = await http(A, "POST", `${P}/delegations`, { commitmentId: personalC.body.data.id, delegateeIndividualId: pb.individualId, followUpOn: today });
  ok("D12", fromPersonal.status === 422, "a personal commitment cannot be delegated to a LifeOS person outside the workspace", fromPersonal);
  const closeDel = await http(A, "POST", `${W}/delegations/${del.body.data.id}/transition`, { to: "completed", expectedVersion: 1 });
  ok("D13", closeDel.body.data?.status === "completed" && !!closeDel.body.data?.closedAt, "the owner closes the delegation", closeDel);
  const back = await http(A, "GET", `${W}/commitments/${dc.body.data.id}`);
  ok("D14", back.body.data.status === "planned", "the commitment returns to its owner as planned", back.body.data?.status);
  const bGone = await http(B, "GET", `${W}/commitments/${dc.body.data.id}`);
  ok("D15", bGone.status === 404, "...and the delegatee's access ends in the same transaction", bGone);
  const del2 = await http(A, "POST", `${W}/delegations`, { commitmentId: dc.body.data.id, delegateeLabel: "Night team", followUpOn: "2020-01-01" });
  ok("D16", del2.status === 201, "after closing, it can be delegated again, here to a named team outside LifeOS", del2);
  const fresh = await http(A, "GET", `${W}/commitments/${dc.body.data.id}`);
  const doneDel = await http(A, "POST", `${W}/commitments/${dc.body.data.id}/transition`, { to: "done", expectedVersion: fresh.body.data.version });
  const del2After = await http(A, "GET", `${W}/delegations/${del2.body.data.id}`);
  ok("D17", doneDel.body.data?.status === "done" && del2After.body.data.status === "completed", "completing a delegated commitment closes its delegation", [doneDel.status, del2After.body.data?.status]);

  // ---- S. the Chief of Staff boundary ----
  const q2 = await http(A, "POST", `${W}/commitments`, { title: `Strategy time ${RUN}`, worldId, important: true, urgent: false, scheduledOn: today, scheduledTime: "10:00", estimatedMinutes: 60 });
  const flex = await http(A, "POST", `${W}/commitments`, { title: `Flexible ${RUN}`, worldId, important: false, urgent: false, scheduledOn: today });
  const ready = q2.status === 201 && flex.status === 201;
  const planW = await http(A, "POST", `${W}/weekly-plans`, { weekStart: monday, intention: "Lead with what matters" });
  const planActive = await http(A, "POST", `${W}/weekly-plans/${planW.body.data.id}/transition`, { to: "active", expectedVersion: 1 });
  const lateDel = await http(A, "POST", `${W}/commitments`, { title: `Late ${RUN}`, worldId, important: true, urgent: true });
  const lateD = await http(A, "POST", `${W}/delegations`, { commitmentId: lateDel.body.data.id, delegateeLabel: "Team", followUpOn: "2020-01-01" });
  ok("S0", ready && planActive.status === 200 && lateD.status === 201, "the week is set up", { q2: q2.status, plan: planActive.status, lateD: lateD.status });

  const before = (await store.where("lifeos_commitment", { workspace_id: org.workspaceId })).map(r => `${r.id}:${r.version}:${r.status}`).sort().join();
  const blocksBefore = (await store.where("lifeos_protected_block", { workspace_id: org.workspaceId })).length;
  const gen = await http(A, "POST", `${W}/suggestions/generate`, { interruption: true });
  ok("S1", gen.status === 200 && gen.body.data.length >= 4, "the rules produce suggestions", gen);
  const kinds = new Set(gen.body.data.map((s: any) => s.kind));
  ok("S2", ["protect_q2", "clarify_inbox", "delegation_follow_up", "big_rock", "replan"].every(k => kinds.has(k)), "all five kinds appear", [...kinds]);
  const after = (await store.where("lifeos_commitment", { workspace_id: org.workspaceId })).map(r => `${r.id}:${r.version}:${r.status}`).sort().join();
  ok("S3", before === after, "generating changed no commitment: no version, no status");
  ok("S4", (await store.where("lifeos_protected_block", { workspace_id: org.workspaceId })).length === blocksBefore, "...and created no protected block");
  ok("S5", gen.body.data.every((s: any) => s.status === "proposed" && s.generator === "rules-v1"), "every result is a proposal, labelled with its generator");
  const followUp = gen.body.data.find((s: any) => s.kind === "delegation_follow_up");
  ok("S6", followUp.materiality === "informational" && followUp.proposedChange === null, "a follow-up proposes nothing to send: an external communication is the person's");
  const genAgain = await http(A, "POST", `${W}/suggestions/generate`, { interruption: true });
  ok("S7", genAgain.status === 200 && genAgain.body.data.length === 0, "running again does not duplicate them", genAgain.body.data?.length);
  const k5 = key();
  const quiet1 = await http(A, "POST", `${P}/suggestions/generate`, {}, { key: k5 });
  const quiet2 = await http(A, "POST", `${P}/suggestions/generate`, {}, { key: k5 });
  ok("S8", quiet1.status === 200 && quiet2.status === 200, "generate is safe to retry", [quiet1.status, quiet2.status]);
  const otherSug = await http(A, "GET", `${X}/suggestions`);
  ok("S9", !otherSug.text.includes(RUN) || otherSug.body.data.length === 0, "suggestions for one organisation never appear in another", otherSug.body.data?.length);
  const personalSug = await http(A, "GET", `${P}/suggestions`);
  ok("S10", !personalSug.text.includes(SECRET) && !personalSug.text.includes("Strategy time"), "...nor in the personal workspace");

  const bSug = await http(B, "GET", `${W}/suggestions/${followUp.id}`);
  ok("S11", bSug.status === 404, "another member cannot read someone's suggestion", bSug);
  const protect = gen.body.data.find((s: any) => s.kind === "protect_q2" && s.targetId === q2.body.data.id);
  const bAccept = await http(B, "POST", `${W}/suggestions/${protect.id}/accept`, {});
  ok("S12", bAccept.status === 404, "...or accept it", bAccept);
  const acceptInfo = await http(A, "POST", `${W}/suggestions/${followUp.id}/accept`, {});
  ok("S13", acceptInfo.status === 409, "an informational suggestion has nothing to apply", acceptInfo);
  const accept = await http(A, "POST", `${W}/suggestions/${protect.id}/accept`, {});
  ok("S14", accept.status === 200 && accept.body.data.status === "accepted" && !!accept.body.data.decidedAt, "the person accepts it", accept);
  const blocks = await http(A, "GET", `${W}/protected-blocks?commitmentId=${q2.body.data.id}`);
  ok("S15", blocks.body.data.length === 1, "...and only then does the block exist", blocks.body.data?.length);
  const block = blocks.body.data[0];
  ok("S16", block.provenanceSource === "ai_suggestion" && block.provenanceRef === protect.id, "the block records that it came from this suggestion", block);
  ok("S17", accept.body.data.targetId === block.id, "the suggestion points at what it created");
  const acceptAgain = await http(A, "POST", `${W}/suggestions/${protect.id}/accept`, {});
  ok("S18", acceptAgain.status === 409, "it cannot be accepted twice", acceptAgain);

  const replan = gen.body.data.find((s: any) => s.kind === "replan");
  const replanTarget = replan.targetId;
  ok("S19", replanTarget !== q2.body.data.id, "the replan did not pick a commitment that is about to be protected", replanTarget);
  // Staleness: the person changes the commitment after the proposal, then accepts it.
  const tBefore = await http(A, "GET", `${W}/commitments/${replanTarget}`);
  const touch = await http(A, "PATCH", `${W}/commitments/${replanTarget}`, { expectedVersion: tBefore.body.data.version, notes: "Changed since" });
  const staleAccept = await http(A, "POST", `${W}/suggestions/${replan.id}/accept`, {});
  ok("S20", touch.status === 200 && staleAccept.status === 409, "a proposal made before the record changed is refused, not applied over it", staleAccept);
  const stillProposed = await http(A, "GET", `${W}/suggestions/${replan.id}`);
  ok("S21", stillProposed.body.data.status === "proposed", "...and the refused decision left no half-state");
  const dismiss = await http(A, "POST", `${W}/suggestions/${replan.id}/dismiss`, {});
  ok("S22", dismiss.body.data?.status === "dismissed", "the person dismisses it", dismiss);
  const dateAfter = await http(A, "GET", `${W}/commitments/${replanTarget}`);
  ok("S23", dateAfter.body.data.scheduledOn === today, "...and the plan is unchanged");

  // A replan accepted cleanly moves the date, and an interruption never picks the protected item
  const protectedOnly = await store.where("lifeos_protected_block", { workspace_id: org.workspaceId, status: "active" });
  const gen2 = await http(A, "POST", `${W}/suggestions/generate`, { interruption: true });
  const rp2 = gen2.body.data.filter((s: any) => s.kind === "replan");
  ok("S24", protectedOnly.length >= 1 && rp2.every((s: any) => s.targetId !== q2.body.data.id), "an interruption never proposes moving protected time", rp2.map((s: any) => s.targetId));
  const liveFlex = await http(A, "POST", `${W}/commitments`, { title: `Flex two ${RUN}`, worldId, important: false, urgent: false, scheduledOn: today });
  await store.mutate({
    actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_suggestion", op: "insert", values: {
      workspace_id: org.workspaceId, owner_individual_id: pa.individualId, kind: "replan", materiality: "material", title: "Direct replan", generator: "rules-v1",
      dedupe_key: `direct:${RUN}`, provenance_source: "system", target_type: "commitment", target_id: liveFlex.body.data.id,
      proposed_change: { action: "patch", resource: "commitments", id: liveFlex.body.data.id, expectedVersion: 1, fields: { scheduledOn: "2099-01-01" } },
    } }],
  });
  const [directRow] = await store.where("lifeos_suggestion", { workspace_id: org.workspaceId, dedupe_key: `direct:${RUN}` });
  const acceptMove = await http(A, "POST", `${W}/suggestions/${directRow.id}/accept`, {});
  const moved = await http(A, "GET", `${W}/commitments/${liveFlex.body.data.id}`);
  ok("S25", acceptMove.status === 200 && moved.body.data.scheduledOn === "2099-01-01" && moved.body.data.provenanceSource === "ai_suggestion", "an accepted replan moves the date, marked as from a suggestion", acceptMove.status);
  // Two concurrent decisions: one commits.
  const raceC = await http(A, "POST", `${W}/commitments`, { title: `Race ${RUN}`, worldId, important: true, urgent: false, scheduledOn: today, scheduledTime: "11:00" });
  await store.mutate({
    actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_suggestion", op: "insert", values: {
      workspace_id: org.workspaceId, owner_individual_id: pa.individualId, kind: "protect_q2", materiality: "material", title: "Race", generator: "rules-v1",
      dedupe_key: `race:${RUN}`, provenance_source: "system", target_type: "commitment", target_id: raceC.body.data.id,
      proposed_change: { action: "create", resource: "protected-blocks", fields: { commitmentId: raceC.body.data.id, label: "Race", startsAt: "2099-02-01T08:00:00Z", endsAt: "2099-02-01T09:00:00Z" } },
    } }],
  });
  const [raceRow] = await store.where("lifeos_suggestion", { workspace_id: org.workspaceId, dedupe_key: `race:${RUN}` });
  const raced = await Promise.all([1, 2, 3].map(() => http(A, "POST", `${W}/suggestions/${raceRow.id}/accept`, {})));
  const raceBlocks = await store.where("lifeos_protected_block", { workspace_id: org.workspaceId, commitment_id: String(raceC.body.data.id) });
  ok("S25b", raced.filter(r => r.status === 200).length === 1 && raceBlocks.length === 1, "three concurrent accepts apply the change once", { statuses: raced.map(r => r.status), blocks: raceBlocks.length });
  // Protecting the item between proposal and acceptance refuses the move.
  await http(A, "POST", `${W}/protected-blocks`, { commitmentId: flex.body.data.id, label: "Now protected", startsAt: "2099-01-01T08:00:00Z", endsAt: "2099-01-01T09:00:00Z" });
  await store.mutate({
    actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_suggestion", op: "insert", values: {
      workspace_id: org.workspaceId, owner_individual_id: pa.individualId, kind: "replan", materiality: "material", title: "Late replan", generator: "rules-v1",
      dedupe_key: `direct2:${RUN}`, provenance_source: "system", target_type: "commitment", target_id: flex.body.data.id,
      proposed_change: { action: "patch", resource: "commitments", id: flex.body.data.id, expectedVersion: (await store.get("lifeos_commitment", flex.body.data.id))?.version, fields: { scheduledOn: "2099-01-01" } },
    } }],
  });
  const [lateRow] = await store.where("lifeos_suggestion", { workspace_id: org.workspaceId, dedupe_key: `direct2:${RUN}` });
  const lateAccept = await http(A, "POST", `${W}/suggestions/${lateRow.id}/accept`, {});
  ok("S26", lateAccept.status === 409 && lateAccept.body.error.code === "conflict", "time protected after the proposal refuses the move at acceptance, at a current version", lateAccept);

  // ---- R. the week and its review ----
  const rock = await http(A, "POST", `${W}/big-rocks`, { weeklyPlanId: planW.body.data.id, commitmentId: q2.body.data.id });
  ok("R1", rock.status === 201 && rock.body.data.status === "selected", "a Big Rock is selected", rock);
  const rockDup = await http(A, "POST", `${W}/big-rocks`, { weeklyPlanId: planW.body.data.id, commitmentId: q2.body.data.id });
  ok("R2", rockDup.status === 409, "the same commitment cannot be a Big Rock twice in one plan", rockDup);
  const q2Fresh = await http(A, "GET", `${W}/commitments/${q2.body.data.id}`);
  await http(A, "POST", `${W}/commitments/${q2.body.data.id}/transition`, { to: "done", expectedVersion: q2Fresh.body.data.version });
  const review = await http(A, "POST", `${W}/weekly-reviews`, { weekStart: monday, weeklyPlanId: planW.body.data.id, reflection: `Reflection ${RUN}` });
  ok("R3", review.status === 201 && review.body.data.snapshot === null, "a weekly review starts as a draft", review);
  const finalised = await http(A, "POST", `${W}/weekly-reviews/${review.body.data.id}/transition`, { to: "final", expectedVersion: 1 });
  const snap = finalised.body.data?.snapshot;
  ok("R4", finalised.status === 200 && snap?.bigRocksAchieved === 1 && snap?.bigRocksSelected === 1 && snap?.completed >= 1, "finalising stores the week's real counts", snap);
  const editFinal = await http(A, "PATCH", `${W}/weekly-reviews/${review.body.data.id}`, { expectedVersion: finalised.body.data.version, reflection: "Rewrite" });
  ok("R5", editFinal.status === 409, "a finalised review cannot be edited", editFinal);
  const sharedReview = await http(A, "POST", `${W}/weekly-reviews`, { weekStart: "2099-01-05", accessScope: "workspace" });
  const adminFinal = await http(C, "POST", `${W}/weekly-reviews/${sharedReview.body.data?.id}/transition`, { to: "final", expectedVersion: 1 });
  ok("R5b", sharedReview.status === 201 && adminFinal.status === 403, "an admin cannot finalise someone's review and publish its private counts", adminFinal);
  const secondPlan = await http(A, "POST", `${W}/weekly-plans`, { weekStart: monday });
  ok("R6", secondPlan.status === 409, "one plan per person per week", secondPlan);
  const bReview = await http(B, "GET", `${W}/weekly-reviews/${review.body.data.id}`);
  ok("R7", bReview.status === 404, "a review is private", bReview);

  // ---- U. audit ----
  const audit = await http(A, "GET", `${W}/audit-events?entityId=${c.id}`);
  const auditTypes = (audit.body.data ?? []).map((e: any) => e.eventType);
  ok("U1", audit.status === 200 && auditTypes[0] === "commitment.created" && auditTypes.includes("commitment.status_changed") && auditTypes.includes("commitment.updated"), "every change to a commitment is in its audit trail", auditTypes);
  ok("U2", !audit.text.includes(SECRET), "audit rows hold no content: the title never appears");
  const statusEvent = audit.body.data.find((e: any) => e.eventType === "commitment.status_changed");
  ok("U3", statusEvent.fromStatus === "inbox" || !!statusEvent.toStatus, "...but they do hold the status change", statusEvent);
  ok("U4", audit.body.data.every((e: any) => e.actorKind === "user" && !!e.actorIndividualId && !!e.traceId), "each row names its actor and joins to a trace", audit.body.data[0]);
  const suggestAudit = await http(A, "GET", `${W}/audit-events?entityId=${block.id}`);
  ok("U5", suggestAudit.body.data[0]?.provenanceSource === "ai_suggestion" && suggestAudit.body.data[0]?.provenanceRef === protect.id, "the audit trail distinguishes a change that came from a suggestion", suggestAudit.body.data[0]);
  const secondWriter = await admin.from("lifeos_world").insert({
    workspace_id: org.workspaceId, owner_individual_id: pa.individualId, title: `Second writer ${RUN}`, provenance_source: "import", created_by: pa.individualId, updated_by: pa.individualId,
  }).select("id, version").single();
  const secondAudit = await admin.from("lifeos_audit_event").select("event_type, actor_kind").eq("entity_id", secondWriter.data?.id);
  ok("U6", secondAudit.data?.length === 1 && secondAudit.data[0].event_type === "world.created", "a second writer that skips the service still leaves an audit row", secondAudit.data);
  const auditUpdate = await admin.from("lifeos_audit_event").update({ event_type: "tampered" }).eq("entity_id", c.id);
  ok("U7", !!auditUpdate.error, "the audit trail refuses an update", auditUpdate.error?.code);
  const auditDelete = await admin.from("lifeos_audit_event").delete().eq("entity_id", c.id);
  ok("U8", !!auditDelete.error, "...and a delete", auditDelete.error?.code);
  const qcDelete = await admin.from("lifeos_quadrant_classification").delete().eq("commitment_id", c.id);
  ok("U9", !!qcDelete.error, "the classification log is append-only too", qcDelete.error?.code);
  const qcDirect = await store.mutate({
    actor: pa.individualId, actorKind: "user", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_quadrant_classification", op: "insert", values: {} }],
  }).then(() => "committed", (e: any) => e.code);
  ok("U10", qcDirect === "validation_failed", "lifeos_mutate cannot write the logs", qcDirect);
  const quadDirect = await store.mutate({
    actor: pa.individualId, actorKind: "user", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_commitment", op: "update", id: c.id, workspace_id: org.workspaceId, values: { quadrant: "q4" } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("U11", quadDirect === "validation_failed", "...and no writer can assign a quadrant", quadDirect);
  const outside = await store.mutate({
    actor: pa.individualId, actorKind: "user", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "profiles", op: "update", id: subject.a, values: { full_name: "x" } }],
  }).then(() => "committed", (e: any) => e.code);
  ok("U12", outside === "validation_failed", "lifeos_mutate refuses any table outside its list", outside);

  // ---- K. the door to the database ----
  const anonClient: any = createClient(url, anonKey, { auth: { persistSession: false } });
  const anonRead = await anonClient.from("lifeos_commitment").select("id").limit(1);
  ok("K1", !!anonRead.error || (anonRead.data ?? []).length === 0, "the anon key reads nothing", anonRead.error?.code);
  const anonRpc = await anonClient.rpc("lifeos_mutate", { p_actor: null, p_actor_kind: "user", p_idempotency_key: null, p_request_hash: null, p_trace_id: null, p_ops: [] });
  ok("K2", !!anonRpc.error, "the anon key cannot call the writer", anonRpc.error?.code);
  const authed: any = createClient(url, anonKey, { auth: { persistSession: false } });
  await authed.auth.signInWithPassword({ email: email("a"), password: PASSWORD });
  const authedRead = await authed.from("lifeos_commitment").select("id").limit(1);
  ok("K3", !!authedRead.error || (authedRead.data ?? []).length === 0, "a signed-in browser session cannot read the tables directly, even its own rows", authedRead.error?.code);
  const authedRpc = await authed.rpc("lifeos_mutate", { p_actor: pa.individualId, p_actor_kind: "user", p_idempotency_key: null, p_request_hash: null, p_trace_id: null, p_ops: [] });
  ok("K4", !!authedRpc.error, "...nor call the writer", authedRpc.error?.code);
  const authedGrant = await authed.from("lifeos_live_grant").select("id").limit(1);
  ok("K5", !!authedGrant.error || (authedGrant.data ?? []).length === 0, "...nor read the grants view", authedGrant.error?.code);
  const authedFlag = await authed.from("lifeos_flag").upsert({ flag: "lifeos_core", enabled: false });
  ok("K6", !!authedFlag.error, "...nor touch the gate", authedFlag.error?.code);

  const conn = crypto.randomUUID();
  await store.mutate({
    actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null,
    ops: [{ t: "lifeos_integration_connection", op: "insert", values: { id: conn, workspace_id: org.workspaceId, owner_individual_id: pa.individualId, provider: "harness", credential_ref: `vault://${RUN}`, provenance_source: "system" } }],
  });
  const connRead = await http(A, "GET", `${W}/integration-connections/${conn}`);
  ok("K7", connRead.status === 200 && !connRead.text.includes("vault") && !("credentialRef" in connRead.body.data), "an integration's credential reference never leaves the server", connRead);
  const connWrite = await http(A, "PATCH", `${W}/integration-connections/${conn}`, { expectedVersion: 1 });
  ok("K8", connWrite.status === 405, "connections are read-only through the API at this stage", connWrite);

  // ---- T. rate limit ----
  const subjectKey = `harness-${RUN}`;
  const t = [await store.rateTake(subjectKey, "x", 2, 60), await store.rateTake(subjectKey, "x", 2, 60), await store.rateTake(subjectKey, "x", 2, 60)];
  ok("T1", t[0].allowed && t[1].allowed && !t[2].allowed && t[2].retryAfter >= 1, "the limiter admits the limit and refuses the next", t);
  const tRace = await Promise.all(Array.from({ length: 10 }, () => store.rateTake(`${subjectKey}-r`, "x", 3, 60)));
  ok("T2", tRace.filter(x => x.allowed).length === 3, "...and is atomic under concurrency", tRace.filter(x => x.allowed).length);
  await admin.from("lifeos_rate_window").update({ hits: 100000 }).eq("subject", pc.individualId).eq("bucket", "read");
  await store.rateTake(pc.individualId, "read", 600, 60);
  await admin.from("lifeos_rate_window").update({ hits: 100000, window_start: new Date().toISOString() }).eq("subject", pc.individualId).eq("bucket", "read");
  const limited = await http(C, "GET", "/me");
  ok("T3", limited.status === 429 && !!limited.headers.get("retry-after") && limited.body.error.code === "rate_limited", "over HTTP: 429 with Retry-After", limited);
  const otherPerson = await http(B, "GET", "/me");
  ok("T4", otherPerson.status === 200, "...and one person's limit does not touch another", otherPerson.status);
  await admin.from("lifeos_rate_window").update({ hits: 0 }).eq("subject", pc.individualId);

  // ---- C. personal continuity ----
  const bPersonal = `/workspaces/${pb.personalWorkspaceId}`;
  const bOwn = await http(B, "POST", `${bPersonal}/commitments`, { title: `B personal ${RUN}` });
  ok("C1", bOwn.status === 201, "B has personal work", bOwn);
  const leavePersonal = await http(B, "POST", `${bPersonal}/leave`, {});
  ok("C2", leavePersonal.status === 409, "nobody can leave their personal workspace", leavePersonal);
  const ownerLeave = await http(A, "POST", `${W}/leave`, {});
  ok("C3", ownerLeave.status === 409, "an organisation owner cannot walk away and orphan it", ownerLeave);
  const bOrgOwn = await http(B, "POST", `${W}/commitments`, { title: `B org ${RUN}` });
  const bShares = await http(B, "POST", `${W}/permission-grants`, { granteeIndividualId: pc.individualId, resourceType: "commitment", resourceId: bOrgOwn.body.data.id, capability: "read" });
  const cSeesB = await http(C, "GET", `${W}/commitments/${bOrgOwn.body.data.id}`);
  ok("C3b", bShares.status === 201 && cSeesB.status === 200, "B has shared one record with C", [bShares.status, cSeesB.status]);
  const leave = await http(B, "POST", `${W}/leave`, {});
  ok("C4", leave.status === 200, "B leaves the organisation", leave);
  const cAfterLeave = await http(C, "GET", `${W}/commitments/${bOrgOwn.body.data.id}`);
  ok("C4b", cAfterLeave.status === 404, "leaving ends what B shared there, in the same transaction", cAfterLeave);
  const bGoneWs = await http(B, "GET", W);
  ok("C5", bGoneWs.status === 404, "...and its workspace is gone for them", bGoneWs);
  const bStillPersonal = await http(B, "GET", `${bPersonal}/commitments/${bOwn.body.data.id}`);
  ok("C6", bStillPersonal.status === 200, "...and their personal work is untouched", bStillPersonal);
  const bMe = await http(B, "GET", "/me");
  ok("C7", !bMe.body.data.workspaces.some((w: any) => w.id === org.workspaceId) && bMe.body.data.workspaces.some((w: any) => w.kind === "personal"), "...and /me lists their personal workspace and not the one they left", bMe.body.data?.workspaces?.length);
  const aOnB = await http(A, "GET", `${W}/commitments/${bOrgOwn.body.data.id}`);
  ok("C8", aOnB.status === 404, "the organisation's owner still cannot read what B left behind as private", aOnB);

  // ---- N. a suspended tenant ----
  const [tenantRow] = await store.where("lifeos_tenant", { id: org.tenantId });
  await store.mutate({ actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_tenant", op: "update", id: org.tenantId, expected_version: Number(tenantRow.version), values: { status: "suspended" } }] });
  const susp = await http(A, "GET", `${W}/commitments`);
  ok("N1", susp.status === 403, "a suspended organisation refuses even its owner", susp);
  const aPersonalStill = await http(A, "GET", `${P}/commitments`);
  ok("N2", aPersonalStill.status === 200 && aPersonalStill.text.includes(`Family dinner ${RUN}`), "...and the person's personal workspace is unaffected", aPersonalStill.status);
  await store.mutate({ actor: pa.individualId, actorKind: "system", idempotencyKey: null, requestHash: null, traceId: null, ops: [{ t: "lifeos_tenant", op: "update", id: org.tenantId, values: { status: "active" } }] });

  // ---- Z. back to off ----
  await setGate(false);
  const off = await http(A, "GET", "/me");
  ok("Z1", off.status === 404 && off.text === "", "gate off again: an empty 404. Staging is left OFF", off);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map(f => `  - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch(async e => {
  console.error(e);
  await setGate(false).catch(() => {});
  process.exit(1);
});
