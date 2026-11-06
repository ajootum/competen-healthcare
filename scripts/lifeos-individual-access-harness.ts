/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LIFEOS-API-001 delivery step 6: optional LifeOS access for Competen Individual, over real HTTP with real sessions.
 *
 *   LIFEOS_BASE_URL=http://localhost:3117 npx tsx scripts/lifeos-individual-access-harness.ts
 *
 * It REFUSES anything but the staging project. It creates new fixture people per run, turns the staging flags on for its
 * run and off at the end, retires the terms row it publishes, and hard-deletes nothing.
 */
import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

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
const RUN = Date.now().toString(36);
const PASSWORD = randomBytes(24).toString("base64url");

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: unknown, msg: string, extra?: unknown) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}${extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 300)}` : ""}`); }
};

const setFlag = async (flag: string, enabled: boolean) => {
  const { error } = await admin.from("lifeos_flag").upsert({ flag, enabled, note: "staging individual access harness", updated_at: new Date().toISOString() });
  if (error) throw new Error(`flag: ${error.message}`);
};

async function person(tag: string) {
  const email = `lifeos-ind-${tag}-${RUN}@competen.test`;
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
  return { id: data.user.id as string, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}

type Res = { status: number; body: any; text: string };
async function http(cookie: string | null, method: string, path: string, body?: unknown): Promise<Res> {
  const write = method !== "GET";
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (write) { headers["content-type"] = "application/json"; headers["idempotency-key"] = randomBytes(8).toString("hex"); }
  const res = await fetch(`${API}${path}`, { method, headers, ...(write ? { body: JSON.stringify(body ?? {}) } : {}), redirect: "manual" });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
}

const entitle = (userId: string) => admin.from("individual_entitlement")
  .insert({ user_id: userId, experience_code: "professional", source: "hq_grant", operating_entity: "competen_holdings", status: "active" })
  .select("id").single();

async function main() {
  console.log(`LIFEOS INDIVIDUAL ACCESS HARNESS -- target ${verdict.ok ? verdict.ref : "?"} -- run ${RUN}\n`);
  await setFlag("lifeos_core", true);
  await setFlag("lifeos_individual_access", false);
  const individual = await person("yes");
  const stranger = await person("no");
  const ent = await entitle(individual.id);
  if (ent.error) throw new Error(`entitle: ${ent.error.message}`);

  // ---- nothing happens by itself ----
  const none = await admin.from("lifeos_identity_link").select("id").eq("subject", individual.id);
  ok("N1", (none.data ?? []).length === 0, "holding Competen Individual creates nothing in LifeOS");
  const me0 = await http(individual.cookie, "GET", "/me");
  ok("N2", me0.status === 403, "...and admits nobody on its own", me0.status);
  const anon = await http(null, "GET", "/access/status");
  ok("N3", anon.status === 401, "the door needs a signed-in person", anon.status);

  // ---- the owner's flag ----
  const off = await http(individual.cookie, "GET", "/access/status");
  ok("F1", off.status === 200 && off.body.data.enabled === false && off.body.data.eligible === false, "flag off: not offered", off.body);
  const offTry = await http(individual.cookie, "POST", "/access/competen-individual", { termsVersion: "x" });
  ok("F2", offTry.status === 403, "flag off: refused even if asked directly", offTry.status);
  await setFlag("lifeos_individual_access", true);

  // ---- eligibility ----
  const strangerStatus = await http(stranger.cookie, "GET", "/access/status");
  ok("E1", strangerStatus.body.data.enabled === true && strangerStatus.body.data.eligible === false, "someone without Competen Individual is not eligible", strangerStatus.body);
  const strangerTry = await http(stranger.cookie, "POST", "/access/competen-individual", { termsVersion: "x" });
  ok("E2", strangerTry.status === 403, "...and is refused if they ask directly", strangerTry.status);

  // ---- legal: no published terms, no opt-in ----
  const published = await admin.from("lifeos_terms").select("version").eq("status", "published");
  for (const r of published.data ?? []) await admin.from("lifeos_terms").update({ status: "retired" }).eq("version", r.version);
  const noTerms = await http(individual.cookie, "POST", "/access/competen-individual", { termsVersion: "x" });
  ok("T1", noTerms.status === 409, "with no published terms, nobody can opt in", noTerms);
  const version = `harness-${RUN}`;
  const terms = await admin.from("lifeos_terms").insert({ version, title: "LifeOS test terms", url: "https://example.test/terms" });
  if (terms.error) throw new Error(`terms: ${terms.error.message}`);
  const stale = await http(individual.cookie, "POST", "/access/competen-individual", { termsVersion: "an-old-version" });
  ok("T2", stale.status === 409 && stale.body.error.details?.current === version, "accepting anything but the current terms is refused", stale);
  const empty = await http(individual.cookie, "POST", "/access/competen-individual", {});
  ok("T3", empty.status === 422, "accepting nothing is refused", empty.status);
  const dbGuard = await admin.from("lifeos_individual").select("id").limit(1).single();
  const noTermsRow = await admin.from("lifeos_entitlement").insert({ individual_id: dbGuard.data.id, source: "competen_individual", provenance_source: "system", created_by: dbGuard.data.id, updated_by: dbGuard.data.id });
  ok("T4", !!noTermsRow.error, "the database refuses opt-in access with no terms recorded", noTermsRow.error?.code);

  // ---- the choice ----
  const status = await http(individual.cookie, "GET", "/access/status");
  ok("C1", status.body.data.eligible === true && status.body.data.terms?.version === version && status.body.data.active === false, "eligible: offered, with the current terms", status.body);
  const on = await http(individual.cookie, "POST", "/access/competen-individual", { termsVersion: version });
  ok("C2", on.status === 201 && on.body.data.created === true, "the person chooses to turn it on", on);
  const again = await http(individual.cookie, "POST", "/access/competen-individual", { termsVersion: version });
  ok("C3", again.status === 200 && again.body.data.individualId === on.body.data.individualId, "choosing twice is harmless", again);
  const me = await http(individual.cookie, "GET", "/me");
  ok("C4", me.status === 200 && me.body.data.workspaces.some((w: any) => w.kind === "personal"), "they get LifeOS and a personal workspace", me.status);
  const held = me.body?.data?.entitlements ?? [];
  ok("C5", held.length === 1 && held[0].source === "competen_individual", "one live entitlement, naming its source", held);
  const row = (await admin.from("lifeos_entitlement").select("terms_version, terms_accepted_at").eq("id", held[0].id).single()).data;
  ok("C6", row?.terms_version === version && !!row?.terms_accepted_at, "the terms they accepted are recorded, with the time", row);
  ok("C7", on.body.data.individualId !== individual.id, "their LifeOS id is not their Competen id");

  // ---- separation ----
  const ws = me.body.data.workspaces.find((w: any) => w.kind === "personal").id;
  const c = await http(individual.cookie, "POST", `/workspaces/${ws}/commitments`, { title: `Keep this ${RUN}` });
  ok("S1", c.status === 201, "they can use it", c.status);
  const strangerRead = await http(stranger.cookie, "GET", `/workspaces/${ws}/commitments`);
  ok("S2", strangerRead.status === 403, "someone else still cannot", strangerRead.status);
  const beforeInd = (await admin.from("individual_entitlement").select("id").eq("user_id", individual.id)).data?.length;
  ok("S3", beforeInd === 1, "LifeOS wrote nothing into Competen Individual");

  // ---- access through Individual ends with it, and the record survives ----
  await admin.from("individual_entitlement").update({ status: "cancelled" }).eq("id", ent.data.id);
  const ended = await http(individual.cookie, "GET", "/me");
  ok("L1", ended.status === 403, "when Competen Individual ends, this access ends too", ended.status);
  const back = await entitle(individual.id);
  const restored = await http(individual.cookie, "GET", `/workspaces/${ws}/commitments`);
  ok("L2", !back.error && restored.status === 200 && restored.text.includes(`Keep this ${RUN}`), "when it returns, their records are still there", restored.status);

  // ---- their own choice to stop ----
  const fresh = (await http(individual.cookie, "GET", "/me")).body.data.entitlements[0];
  const stop = await http(individual.cookie, "POST", `/me/entitlements/${fresh.id}/end`, { expectedVersion: fresh.version });
  ok("O1", stop.status === 200 && stop.body.data.status === "revoked", "the person turns it off", stop);
  const stopped = await http(individual.cookie, "GET", "/me");
  ok("O2", stopped.status === 403, "...and access ends", stopped.status);
  const statusAfter = await http(individual.cookie, "GET", "/access/status");
  ok("O3", statusAfter.body.data.active === false && statusAfter.body.data.eligible === true, "...and they may choose again", statusAfter.body);
  const onAgain = await http(individual.cookie, "POST", "/access/competen-individual", { termsVersion: version });
  const returned = await http(individual.cookie, "GET", `/workspaces/${ws}/commitments`);
  ok("O4", onAgain.status === 200 && onAgain.body.data.created === false && returned.text.includes(`Keep this ${RUN}`), "turning it on again finds the same records", onAgain.status);
  const others = await admin.from("lifeos_entitlement").insert({ individual_id: on.body.data.individualId, source: "platform_grant", provenance_source: "system", created_by: on.body.data.individualId, updated_by: on.body.data.individualId }).select("id, version").single();
  const cannotEnd = await http(individual.cookie, "POST", `/me/entitlements/${others.data?.id}/end`, { expectedVersion: 1 });
  ok("O5", cannotEnd.status === 403, "access someone else gave cannot be ended this way", cannotEnd.status);
  const strangerEnd = await http(stranger.cookie, "POST", `/me/entitlements/${others.data?.id}/end`, { expectedVersion: 1 });
  ok("O6", strangerEnd.status === 403, "...and a person without LifeOS cannot reach the route at all", strangerEnd.status);

  // ---- browser cannot touch the door's data ----
  const browser: any = createClient(url, anonKey, { auth: { persistSession: false } });
  const read = await browser.from("lifeos_terms").select("version").limit(1);
  ok("B1", !!read.error || (read.data ?? []).length === 0, "the anon key cannot read the terms table", read.error?.code);

  await setFlag("lifeos_individual_access", false);
  const offAgain = await http(individual.cookie, "GET", "/access/status");
  ok("Z1", offAgain.body.data.eligible === false, "flag off again: no longer offered");
  await admin.from("lifeos_terms").update({ status: "retired" }).eq("version", version);
  await setFlag("lifeos_core", false);
  const gateOff = await http(individual.cookie, "GET", "/access/status");
  ok("Z2", gateOff.status === 404 && gateOff.text === "", "gate off: the door does not exist. Staging is left OFF", gateOff.status);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map(f => `  - ${f}`).join("\n")); process.exit(1); }
}

main().catch(async e => {
  console.error(String(e).slice(0, 1200));
  await setFlag("lifeos_individual_access", false).catch(() => {});
  await setFlag("lifeos_core", false).catch(() => {});
  process.exit(1);
});
