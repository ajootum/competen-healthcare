/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C5 WIRING ACCEPTANCE -- COMPETEN-PROFESSIONAL-COMPETENCY-01, the person's side of the Verification Studio (#128),
 * STAGING ONLY, over HTTP.
 *
 * IND-007 accepted items 17-22 (the Studio, the assessor, the decision) on staging, with appointed synthetic identities
 * since retired. This checks what Professional adds on top, through the real route a person uses:
 *   W1  the competency page offers the methods C5 publishes for a catalogue competency;
 *   W2  a request carries the chosen method and the evidence linked to the competency, read back through the adapter;
 *   W3  further evidence sends only what the request does not hold, and nothing twice;
 *   W4  another person's request is refused, for further evidence and for withdrawal;
 *   W5  the person withdraws, and C5 records it (state withdrawn, nothing deleted);
 *   W6  a decision C5 revoked is read with its class and standing and is never current or verified (IND-007's record).
 *
 * ⚠ STAGING ONLY (assertSafeTarget), BASE_URL a local staging-pointed dev server. PEND until 510 and 520 are applied.
 * Own harness-prof05-c5wire identity, deleted after with its requests (510 cascades from the person).
 *
 *   BASE_URL=http://localhost:3150 npx tsx scripts/privileged-harnesses.ts --staging --only professional-c5-wiring-acceptance
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { loadCatalogueFor } from "../src/lib/individual/catalogue";
import { parseEntry, parseEvidenceLink } from "../src/lib/individual/professional/competency-form";
import { addEntry, linkEvidence } from "../src/lib/individual/professional/competency-store";
import { currentDecision, loadVerifications, verificationMethods, verifiedNow } from "../src/lib/individual/professional/competency-verification";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anon) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "professional-c5-wiring-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (!/^http:\/\/localhost:\d+$/.test(BASE)) { console.error("REFUSING: BASE_URL must be a local staging-pointed dev server."); process.exit(1); }

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); } };
const EMAIL = "harness-prof05-c5wire@competen.test";
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r.value; };

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function cleanup() {
  const u = await findUser(EMAIL);
  if (!u) return;
  await admin.from("individual_professional_my_competency").delete().eq("user_id", u.id);
  for (const t of ["individual_professional_cpd", "individual_professional_profile", "individual_legal_acceptance", "individual_entitlement", "individual_membership"])
    await admin.from(t).delete().eq("user_id", u.id);
  await admin.from("audit_log").delete().eq("actor_id", u.id);
  // 510's requests, evidence and events go by cascade from the person.
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
async function session(email: string, password: string) {
  const s = await createClient(url!, anon!, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`sign-in: ${s.error?.message}`);
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s.data.session)).toString("base64")}`;
}
const call = async (cookie: string, method: string, body: any) => {
  const res = await fetch(`${BASE}/api/individual/professional/competency-verification`, { method, headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });
  return { status: res.status, json: await res.json().catch(() => null) as any };
};
const evidenceRows = async (requestId: string) => (await admin.from("competency_verification_evidence").select("id, portfolio_link_id").eq("request_id", requestId)).data ?? [];

async function main() {
  console.log(`C5 WIRING ACCEPTANCE against ${ref}, route at ${BASE}\n`);
  for (const [t, m] of [["competency_verification_request", "510"], ["individual_professional_self_assessment", "520"]]) {
    const probe = await admin.from(t).select("id").limit(0);
    if (probe.error) { console.log(`PEND -- migration ${m} is not applied here (${probe.error.code}). Nothing created.`); return; }
  }
  await cleanup();
  try {
    // A catalogue competency with a method C5 publishes.
    const offered = (await loadCatalogueFor(admin, "professional")) ?? [];
    let c: (typeof offered)[number] | null = null, methods: { code: string; name: string }[] = [];
    for (const o of offered) {
      const m = await verificationMethods(admin, o.competencyId);
      if (m && m.provisioned && m.methods.length) { c = o; methods = m.methods; break; }
    }
    ok("W1. a catalogue competency offered to Professional has a method C5 publishes, read by name", !!c && methods.every(m => !!m.name && !!m.code), c ? `${c.title}: ${methods.map(m => m.name).join(", ")}` : "none offered with a method");
    if (!c) throw new Error("no offered competency has a published C5 method on staging");

    const password = `c5w-${randomBytes(12).toString("hex")}-Aa1!`;
    const { data: created } = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true, user_metadata: { full_name: "Harness C5 Requester" } });
    const me = created.user.id as string;
    await admin.from("profiles").update({ full_name: "Harness C5 Requester", role: null }).eq("id", me);
    const g = validateGrant({ targetUserId: me, experiences: ["professional"], note: "C5 wiring acceptance" });
    if (isGrantRefusal(g)) throw new Error(g.message);
    await grantIndividualAccess(admin, g, me);
    await admin.from("individual_professional_profile").insert({ user_id: me, experience_code: "professional", self_declared_profession: "Clinician", registration_completed_at: new Date().toISOString() });
    const policy = (await loadIndividualPolicy(admin)).professionalCompetency;
    const entry = await addEntry(admin, me, must(parseEntry({ competencyId: c.competencyId }, policy, offered)));
    if (!entry.ok || !entry.id) throw new Error("entry");
    const { data: entryRow } = await admin.from("individual_professional_my_competency").select("id, framework_version").eq("id", entry.id).single();
    const { data: cpd } = await admin.from("individual_professional_cpd").insert([
      { user_id: me, experience_code: "professional", activity_type: "course", title: "C5 wire: first course", hours: 2, activity_date: yesterday },
      { user_id: me, experience_code: "professional", activity_type: "course", title: "C5 wire: second course", hours: 1, activity_date: yesterday },
    ]).select("id");
    const link = async (cpdId: string) => linkEvidence(admin, me, entryRow, must(parseEvidenceLink({ kind: "cpd", sourceId: cpdId, relation: policy.relations[0]?.code ?? "" }, { outcomes: c!.outcomes, policy })));
    const l1 = await link(cpd[0].id);
    const cookie = await session(EMAIL, password);

    // W2
    const asked = await call(cookie, "POST", { entryId: entry.id, ...(methods.length > 1 ? { method: methods[0].code } : {}) });
    const requestId = asked.json?.requestId as string | undefined;
    const read = await loadVerifications(admin, me, c.competencyId);
    const mine = read.provisioned && read.items ? read.items.find(i => i.requestId === requestId) : undefined;
    const { data: reqRow } = requestId ? await admin.from("competency_verification_request").select("method_version_id, user_id").eq("id", requestId).maybeSingle() : { data: null };
    ok("W2. a request carries the chosen method and the linked evidence, read back through the adapter",
      asked.status === 201 && !!mine && mine.method === methods[0].name && mine.evidence.length === 1 && l1.ok && mine.evidence[0].linkId === l1.id && reqRow?.user_id === me
      && mine.statusLabel === "Waiting for an assessor", `status ${asked.status} ${JSON.stringify(asked.json)?.slice(0, 160)}`);
    if (!requestId) throw new Error("no request");

    // W3
    const nothingNew = await call(cookie, "PATCH", { requestId, action: "add_evidence", entryId: entry.id });
    await link(cpd[1].id);
    const added = await call(cookie, "PATCH", { requestId, action: "add_evidence", entryId: entry.id });
    const again = await call(cookie, "PATCH", { requestId, action: "add_evidence", entryId: entry.id });
    const rows = await evidenceRows(requestId);
    ok("W3. further evidence sends only the newly linked record, and nothing twice", nothingNew.status === 400 && added.status === 200 && added.json?.added === 1 && again.status === 400
      && rows.length === 2 && new Set(rows.map((r: any) => r.portfolio_link_id)).size === 2, `${nothingNew.status}/${added.status}/${again.status}, ${rows.length} rows`);

    // W4: IND-007's requester's request, from the staging record, must be refused to this person.
    const { data: other } = await admin.from("competency_verification_request").select("id, user_id").neq("user_id", me).limit(1).maybeSingle();
    const otherEvents = other ? (await admin.from("competency_verification_event").select("id").eq("request_id", other.id)).data?.length ?? 0 : 0;
    const wOther = other ? await call(cookie, "PATCH", { requestId: other.id, action: "withdraw" }) : null;
    const aOther = other ? await call(cookie, "PATCH", { requestId: other.id, action: "add_evidence", entryId: entry.id }) : null;
    const otherAfter = other ? (await admin.from("competency_verification_event").select("id").eq("request_id", other.id)).data?.length ?? 0 : 0;
    ok("W4. another person's request is refused, for further evidence and for withdrawal, and is unchanged", !!other && !!wOther && wOther.status >= 400 && !!aOther && aOther.status === 404 && otherAfter === otherEvents,
      other ? `withdraw ${wOther?.status}, evidence ${aOther?.status}, events ${otherEvents}->${otherAfter}` : "no other request on staging");

    // W5
    const withdrawn = await call(cookie, "PATCH", { requestId, action: "withdraw" });
    const after = await loadVerifications(admin, me, c.competencyId);
    const w = after.provisioned && after.items ? after.items.find(i => i.requestId === requestId) : undefined;
    ok("W5. the person withdraws their own request: C5 records it, nothing is deleted", withdrawn.status === 200 && w?.status === "withdrawn" && w.statusLabel === "Withdrawn" && (await evidenceRows(requestId)).length === 2);

    // W6: the decision IND-007 recorded and then revoked, read through the adapter.
    const { data: dec } = await admin.from("competency_verification_decision").select("user_id, outcome_class").eq("outcome_class", "verified").limit(5);
    let seen = false, wrong = false;
    for (const d of dec ?? []) {
      const r = await loadVerifications(admin, d.user_id);
      for (const v of r.provisioned && r.items ? r.items : []) for (const x of v.decisions) {
        if (x.outcomeClass !== "verified") continue;
        seen = true;
        if (x.standing !== "current" && (currentDecision(x, today) || verifiedNow(x, today))) wrong = true;
        if (x.standing === "revoked" && !x.revokedAt) wrong = true;
      }
    }
    ok("W6. a verified decision C5 revoked keeps its class, reads Revoked, and is never current or verified", seen && !wrong, seen ? "" : "no verified decision on staging");
  } finally {
    await cleanup();
    ok("Z1. cleanup: no harness identity left", !(await findUser(EMAIL)));
  }
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
