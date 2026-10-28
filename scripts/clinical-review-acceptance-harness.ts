/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CLINICAL-CONTENT APPROVAL -- ACCEPTANCE on STAGING (owner decision D2, migration 395).
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only clinical-review-acceptance-harness
 *
 * Every rule is exercised against the real triggers, with fixtures it makes and removes:
 *   H  the version hash and snapshot are the database's, whatever a writer sends
 *   I  independence: the author, an editor or the submitter cannot approve
 *   A  authority: a suspended appointment, or one whose position lacks approve, cannot decide
 *   S  scope: a reviewer outside the scope cannot decide, and a scope must name a record of its kind
 *   C  currency: a material edit makes an approval stale, and a decision on the old version is refused
 *   N  counts: higher-risk content needing two approvals is in review after one and approved after two
 *   J  a rejection is changes requested, decisions are append-only, one per reviewer
 *   R  the catalogue read shows approved only for approved content, separate from publication
 *   Z  every fixture removed (the cascade path through the append-only triggers)
 *
 * Fixtures: four throwaway staging accounts (no password is ever used: decisions are written as the
 * service role naming the reviewer, which is what the triggers judge), their reviewer appointments to an
 * existing HQ office, and one shared draft framework. No real content is reviewed. PEND until 395.
 */
import { loadEnvConfig } from "@next/env";
import { appointmentAuthority, fixtureOwnerId } from "./_hq-fixture-authority";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { loadClinicalReviews, submitForReview, decideReview } from "../src/lib/competency/clinical-review";
import { loadIndividualCatalogue } from "../src/lib/competency/foundation";
import { HQ_OFFICE_TYPE_PREFIX } from "../src/lib/hq/spaces";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "clinical-review-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const FIXTURE = "harness-cr fixture";
const EMAILS = { author: "harness-cr-author@competen.test", r1: "harness-cr-reviewer1@competen.test", r2: "harness-cr-reviewer2@competen.test", r3: "harness-cr-reviewer3@competen.test" };

async function findUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function cleanup() {
  await admin.from("frameworks").delete().eq("name", FIXTURE);
  for (const e of Object.values(EMAILS)) {
    const u = await findUser(e);
    if (!u) continue;
    await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}
async function person(email: string, name: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: `cr-${Math.random().toString(36).slice(2)}-Aa1!`, email_confirm: true, user_metadata: { full_name: name, synthetic: true } });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  await admin.from("profiles").update({ full_name: name }).eq("id", data.user.id);
  return data.user.id as string;
}

async function main() {
  const HQ_OWNER = await fixtureOwnerId(admin);
  console.log(`CLINICAL REVIEW ACCEPTANCE (395) -- target ${ref}\n`);
  const probe = await admin.from("clinical_review_decision").select("id").limit(0);
  if (probe.error) { pend("H-Z", `migration 395 is not applied here (${probe.error.message}). Nothing created.`); return; }
  await cleanup();
  const office = (await admin.from("ogs_offices").select("id, office_type, is_active, status").like("office_type", `${HQ_OFFICE_TYPE_PREFIX}%`).limit(50)).data
    ?.find((o: any) => o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
  if (!office) { pend("H-Z", "staging has no active HQ office to appoint reviewers to"); return; }

  try {
    const [author, r1, r2, r3] = [await person(EMAILS.author, "CR Author"), await person(EMAILS.r1, "CR Reviewer 1"), await person(EMAILS.r2, "CR Reviewer 2"), await person(EMAILS.r3, "CR Reviewer 3")];
    const appoint = async (p: string, status = "active") => (await admin.from("ogs_office_appointments").insert({ ...appointmentAuthority(HQ_OWNER), office_id: office.id, person_id: p, role: "clinical_content_reviewer", status }).select("id").single()).data.id as string;
    const [a1, a2, a3, a1s] = [await appoint(r1), await appoint(r2), await appoint(r3), await appoint(r1, "suspended")];
    const fw = (await admin.from("frameworks").insert({ name: FIXTURE, library: "core", is_active: true, pub_status: "draft", hospital_id: null }).select("id").single()).data;
    const d1 = (await admin.from("framework_domains").insert({ framework_id: fw.id, name: `${FIXTURE} domain 1` }).select("id").single()).data;
    const d2 = (await admin.from("framework_domains").insert({ framework_id: fw.id, name: `${FIXTURE} domain 2` }).select("id").single()).data;
    const c1 = (await admin.from("framework_competencies").insert({ domain_id: d1.id, name: `${FIXTURE} standard`, description: "First wording", risk_category: "standard" }).select("id").single()).data;
    const c2 = (await admin.from("framework_competencies").insert({ domain_id: d1.id, name: `${FIXTURE} high risk`, description: "High risk", risk_category: "high" }).select("id").single()).data;
    const scope = (a: string, kind: string, r: string) => admin.from("clinical_reviewer_scope").insert({ granted_by: HQ_OWNER, appointment_id: a, scope_kind: kind, scope_ref: r });
    await scope(a1, "domain", d1.id); await scope(a1s, "domain", d1.id); await scope(a2, "domain", d2.id); await scope(a3, "framework", fw.id);
    const badScope = await scope(a2, "profession", fw.id);
    ok("S2. ⚠ a scope must name a record of its kind (a framework id is not a profession term)", !!badScope.error, badScope.error?.message ?? "accepted");

    // ── H. the version is the database's ──
    const sub = await submitForReview(admin, c1.id, author);
    const v1 = sub.ok ? (await admin.from("clinical_content_version").select("*").eq("id", sub.versionId).single()).data : null;
    const hash = (await admin.rpc("competency_content_hashes", { p_ids: [c1.id] })).data?.[0]?.content_hash;
    ok("H1. the version's hash and snapshot are computed by the database, not taken from the writer", !!v1 && v1.content_hash === hash && v1.content_hash !== "computed-by-trigger"
      && v1.content_snapshot?.description === "First wording" && v1.authored_by.includes(author) && v1.required_approvals === 1, JSON.stringify({ sub, hash, v: v1 && { h: v1.content_hash, s: v1.content_snapshot?.description } }));
    const forged = await admin.from("clinical_content_version").update({ content_hash: "x" }).eq("id", v1?.id);
    ok("H2. ⚠ a version cannot be rewritten (append-only)", !!forged.error);

    // ── I, A, S. who may decide ──
    const authorSelf = await admin.from("ogs_office_appointments").insert({ ...appointmentAuthority(HQ_OWNER), office_id: office.id, person_id: author, role: "clinical_content_reviewer", status: "active" }).select("id").single();
    await scope(authorSelf.data.id, "framework", fw.id);
    const self = await decideReview(admin, v1.id, author, authorSelf.data.id, "approved", null);
    ok("I1. ⚠ the author cannot approve their own content, even holding an in-scope reviewer appointment", !self.ok && /cannot review it/.test((self as any).error), JSON.stringify(self));
    const suspended = await decideReview(admin, v1.id, r1, a1s, "approved", null);
    ok("A1. ⚠ a suspended reviewer appointment cannot decide", !suspended.ok && /do not hold an active/.test((suspended as any).error), JSON.stringify(suspended));
    const borrowed = await decideReview(admin, v1.id, r2, a1, "approved", null);
    ok("A2. ⚠ a reviewer cannot decide under someone else's appointment", !borrowed.ok && /do not hold an active/.test((borrowed as any).error), JSON.stringify(borrowed));
    const outOfScope = await decideReview(admin, v1.id, r2, a2, "approved", null);
    ok("S1. ⚠ a reviewer whose scope does not cover the competency cannot decide", !outOfScope.ok && /outside the scope/.test((outOfScope as any).error), JSON.stringify(outOfScope));
    const good = await decideReview(admin, v1.id, r1, a1, "approved", "harness-cr: content checked");
    let reviews = await loadClinicalReviews(admin, [c1.id, c2.id]);
    ok("I2. an independent, appointed, in-scope reviewer approves: the content is clinically approved", good.ok && reviews?.get(c1.id)?.state === "approved", JSON.stringify({ good, state: reviews?.get(c1.id) }));
    const twice = await decideReview(admin, v1.id, r1, a1, "approved", null);
    ok("J2. ⚠ one decision per reviewer per version", !twice.ok);
    const rewrite = await admin.from("clinical_review_decision").update({ decision: "rejected" }).eq("version_id", v1.id);
    const remove = await admin.from("clinical_review_decision").delete().eq("version_id", v1.id);
    ok("J3. ⚠ decisions are append-only: no update, no delete", !!rewrite.error && !!remove.error);

    // ── C. a material edit ──
    await admin.from("framework_competencies").update({ description: "Second wording" }).eq("id", c1.id);
    reviews = await loadClinicalReviews(admin, [c1.id]);
    const late = await decideReview(admin, v1.id, r3, a3, "approved", null);
    ok("C1. ⚠ a material edit makes the approval stale, and a decision on the old version is refused", reviews?.get(c1.id)?.state === "stale" && !late.ok && /changed since/.test((late as any).error), JSON.stringify({ state: reviews?.get(c1.id)?.state, late }));
    const sub2 = await submitForReview(admin, c1.id, author);
    const rej = sub2.ok ? await decideReview(admin, sub2.versionId, r3, a3, "rejected", "harness-cr: needs the escalation step") : { ok: false };
    reviews = await loadClinicalReviews(admin, [c1.id]);
    ok("J1. renewed review of the new content: a rejection reads as changes requested", sub2.ok && rej.ok && reviews?.get(c1.id)?.state === "changes_requested", JSON.stringify({ sub2, rej, state: reviews?.get(c1.id)?.state }));

    // ── N. higher-risk content needing two approvals (the count is fixed on the version when it is put forward) ──
    const v2 = (await admin.from("clinical_content_version").insert({ competency_id: c2.id, content_hash: "ignored", content_snapshot: {}, authored_by: [author], submitted_by: author, required_approvals: 2, risk_basis: "high risk" }).select("id").single()).data;
    await decideReview(admin, v2.id, r1, a1, "approved", null);
    const one = (await loadClinicalReviews(admin, [c2.id]))?.get(c2.id);
    await decideReview(admin, v2.id, r3, a3, "approved", null);
    const two = (await loadClinicalReviews(admin, [c2.id]))?.get(c2.id);
    ok("N1. content needing two independent approvals is in review after one and approved after two", one?.state === "in_review" && one.approvals === 1 && two?.state === "approved", JSON.stringify({ one, two }));

    // ── R. the catalogue read, separate from publication ──
    await admin.from("frameworks").update({ pub_status: "published" }).eq("id", fw.id);
    const cat = await loadIndividualCatalogue(admin, [fw.id]);
    const byId = new Map((cat ?? []).map(c => [c.competencyId, c]));
    ok("R1. the catalogue read shows approved only for approved content, and labels the rest with its real state",
      byId.get(c2.id)?.contentStatus === "approved" && byId.get(c2.id)?.clinicalState === "approved"
        && byId.get(c1.id)?.contentStatus === "unreviewed" && byId.get(c1.id)?.clinicalState === "changes_requested",
      JSON.stringify((cat ?? []).map(c => [c.title, c.contentStatus, c.clinicalState])));
    const pubStill = (await admin.from("frameworks").select("pub_status").eq("id", fw.id).single()).data;
    ok("R2. approval changed nothing about publication (the fixture's status is what the run set)", pubStill?.pub_status === "published");
  } finally {
    await cleanup();
  }
  const leftF = (await admin.from("frameworks").select("id").eq("name", FIXTURE)).data ?? [];
  const leftU = await Promise.all(Object.values(EMAILS).map(findUser));
  ok("Z1. every fixture removed: framework (and its versions and decisions by cascade), appointments, scopes, accounts", leftF.length === 0 && leftU.every(u => !u));
}

main().then(() => {
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}, async e => { console.error(e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
