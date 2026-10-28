/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN-LEARNING-01 -- STAGING ACCEPTANCE OF MIGRATIONS 460-464 AND OF THE CODE ON THEM (product definition s21).
 *
 * The two acceptance journeys, at library level against the real schema and triggers (no HTTP, no payment provider):
 *
 *   A  a hosted ECG course: an author builds it in the studio and maps it to CFCA (s21.1-2), an independent scoped
 *      reviewer approves it through 395/461 and someone else publishes it (s21.3), a learner discovers it (s21.4),
 *      paid access is refused until a verified purchase opens a course entitlement through the Holdings settlement
 *      adapter, idempotently (s21.5-6), the learner completes lessons and a knowledge check (s21.7), one record is
 *      written (s21.8), Professional and the Passport read it by reference (s21.9-10), certificates are issued under
 *      a separate issuer authorisation and verify publicly (s21.10), and the history outlives the entitlement (s21.15)
 *   B  an external course: a listing approved on the listing route only (s21.11), opened, completed by the learner with
 *      and without a document (s21.12), and never labelled verified (s21.13)
 *   X  the separations (D8), the course-only member with no Scholar or Professional (D2, s21.14 for Individual), and
 *      no AI call anywhere (s21.16-17)
 *
 * ⚠ STAGING ONLY. assertSafeTarget refuses production before any client is built:
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only learning-acceptance
 *
 * ⚠ FLAGS. It turns learning_app ON for its own run and restores it exactly. It never writes learning_commerce,
 * individual_app or individual_commerce: settlement is driven through LEARNING_SETTLEMENT.onPaid, as the P1 harness
 * drives the Individual adapter, so no payment provider is called. A real Flutterwave TEST-key purchase is the
 * separate browser step in the build record.
 *
 * It creates and deletes its own harness-lrn-* identities and their HQ appointments. The fixture providers and
 * offerings (LRN-HARNESS-*) stay RETIRED as the record, by design, as the case harness leaves its fixture case.
 * PEND (exit 0, nothing created) until 464 is applied.
 */
import { loadEnvConfig } from "@next/env";
import { appointmentAuthority, fixtureOwnerId } from "./_hq-fixture-authority";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { HQ_OFFICE_TYPE_PREFIX } from "../src/lib/hq/spaces";
import { decideReview } from "../src/lib/competency/clinical-review";
import { hostedTemplate, externalTemplate, type Blueprint } from "../src/lib/learning/blueprint";
import { LEARNING_APP_FLAG } from "../src/lib/learning/policy";
import { authoriseCertificates, createOffering, createProvider, decidePrice, proposePrice, publishVersion, retireOffering, saveDraft, submitVersion } from "../src/lib/learning/studio";
import { publishedCatalogue } from "../src/lib/learning/catalogue";
import { answerCheck, completeActivity, enrol, myRecords, recordExternalCompletion, verifyCertificate } from "../src/lib/learning/record";
import { LEARNING_SETTLEMENT } from "../src/lib/learning/commerce";
import { learningCpdLines, learningPassportItems, loadLearningRecords } from "../src/lib/learning/products";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "learning-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);

const EMAILS = { author: "harness-lrn-author@competen.test", rev: "harness-lrn-reviewer@competen.test", pub: "harness-lrn-publisher@competen.test",
  price: "harness-lrn-price@competen.test", issuer: "harness-lrn-issuer@competen.test", learner: "harness-lrn-learner@competen.test", learner2: "harness-lrn-learner2@competen.test" };

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
  for (const e of Object.values(EMAILS)) {
    const u = await findUser(e);
    if (!u) continue;
    await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("individual_membership").delete().eq("user_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
  await admin.from("individual_checkout_event").delete().like("provider_event_id", "harness-lrn-%");
}
async function person(email: string, name: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: `lrn-${Math.random().toString(36).slice(2)}-Aa1!`, email_confirm: true, user_metadata: { full_name: name, synthetic: true } });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  await admin.from("profiles").update({ full_name: name }).eq("id", data.user.id);
  return data.user.id as string;
}
const aiRows = async (ids: string[]) => { const r = await admin.from("plat_ai_requests").select("id", { count: "exact", head: true }).in("actor_id", ids); return r.error ? null : (r.count ?? 0); };

/** A complete hosted ECG course on one competency: one lesson, one assessed check, a certificate, paid access. */
function ecg(competencyId: string, title: string): Blueprint {
  const b = hostedTemplate(title);
  b.summary = "Read a 12-lead ECG systematically and recognise the rhythms that need escalation. Staging fixture.";
  b.topics = ["ECG", "cardiac"];
  b.objectives = [{ id: "obj-1", text: "Interpret a 12-lead ECG systematically", outcomeRefs: [{ competencyId, index: -1, relation: "develops" }, { competencyId, index: -1, relation: "assesses" }] }];
  b.modules = [{ id: "m1", title: "Reading the ECG", kind: "module", activities: [
    { id: "l1", kind: "lesson", title: "The 12 leads", minutes: 30, blocks: [{ type: "text", text: "A 12-lead ECG records the heart's electrical activity from twelve views. Staging fixture text." }] },
    { id: "q1", kind: "check", title: "Check", passMark: 100, questions: [{ id: "q1-1", prompt: "What is the normal PR interval?", options: [{ id: "a", text: "0.12 to 0.20 seconds" }, { id: "b", text: "0.40 seconds" }], correct: ["a"], rationale: "A normal PR interval is 120 to 200 ms." }] },
  ] }];
  b.completion = { requiredActivityIds: ["l1", "q1"], assessedCheckIds: ["q1"] };
  b.cpd = { hours: 1, points: null, note: "Learning hours, not accredited CPD" };
  return b;
}

async function main() {
  const HQ_OWNER = await fixtureOwnerId(admin);
  console.log(`LEARNING ACCEPTANCE (460-464) -- target ${ref}\n`);
  const probe = await admin.from("learning_offering_price").select("id").limit(0);
  const probe464 = await admin.from("hq_position").select("code").eq("code", "learning_certificate_issuer").maybeSingle();
  if (probe.error || !probe464.data) { pend("L-Z", `migrations 460-464 are not applied here (${probe.error?.message ?? "464 positions absent"}). Nothing created.`); return; }
  await cleanup();
  const office = (await admin.from("ogs_offices").select("id, office_type, is_active, status").like("office_type", `${HQ_OFFICE_TYPE_PREFIX}%`).limit(50)).data
    ?.find((o: any) => o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
  const fw = (await admin.from("frameworks").select("id").eq("code", "CF-FOUND").is("hospital_id", null).maybeSingle()).data;
  const comp = fw ? (await admin.from("framework_competencies").select("id, code, framework_domains!inner(framework_id)").eq("framework_domains.framework_id", fw.id).eq("code", "CF-PS-001").maybeSingle()).data : null;
  if (!office || !fw || !comp) { pend("L-Z", "staging needs an active HQ office and CF-FOUND's CF-PS-001"); return; }
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 12);
  const prior = (await admin.from("practice_platform_flags").select("flag, enabled, note").eq("flag", LEARNING_APP_FLAG).maybeSingle()).data;
  const setFlag = (enabled: boolean) => admin.from("practice_platform_flags").upsert({ flag: LEARNING_APP_FLAG, enabled, note: "learning-acceptance-harness: on for its own run, restored after" }, { onConflict: "flag" });
  const offerings: string[] = [];

  try {
    const [author, rev, pub, pricer, issuer, learner, learner2] = [await person(EMAILS.author, "LRN Author (synthetic)"), await person(EMAILS.rev, "LRN Reviewer (synthetic)"),
      await person(EMAILS.pub, "LRN Publisher (synthetic)"), await person(EMAILS.price, "LRN Price Approver (synthetic)"), await person(EMAILS.issuer, "LRN Issuer (synthetic)"),
      await person(EMAILS.learner, "LRN Learner (synthetic)"), await person(EMAILS.learner2, "LRN Learner Two (synthetic)")];
    const people = [author, rev, pub, pricer, issuer, learner, learner2];
    const appoint = async (p: string, role: string) => (await admin.from("ogs_office_appointments").insert({ ...appointmentAuthority(HQ_OWNER), office_id: office.id, person_id: p, role, status: "active" }).select("id").single()).data.id as string;
    await appoint(author, "learning_course_author"); await appoint(pub, "learning_publisher"); await appoint(pricer, "learning_price_approver"); await appoint(issuer, "learning_certificate_issuer");
    const revAppt = await appoint(rev, "clinical_content_reviewer");
    await admin.from("clinical_reviewer_scope").insert({ granted_by: HQ_OWNER, appointment_id: revAppt, scope_kind: "framework", scope_ref: fw.id });
    // Course-only members: an Individual membership and NO Scholar or Professional entitlement (D2, D5).
    for (const u of [learner, learner2]) await admin.from("individual_membership").insert({ user_id: u, status: "active", source: "hq_grant", granted_by: author });
    const ai0 = await aiRows(people);
    await setFlag(true);

    // ── A1-A3: studio, CFCA, review, independent publication ──
    const prov = await createProvider(admin, author, { code: `HARNESS-${stamp}`, name: "Competen Holdings (harness)", kind: "competen" });
    ok("A0. a provider is created", prov.ok, JSON.stringify(prov));
    const P = (prov as any).providerId;
    const made = await createOffering(admin, author, { code: `LRN-HARNESS-${stamp}`, title: `ECG Interpretation (harness ${stamp})`, source: "competen", delivery: "hosted", offeringType: "course",
      responsibilities: { contentOwnerId: P, deliveryProviderId: P, certificateIssuerId: P, commercialProviderId: P } });
    ok("A1. an author creates a Competen course with its first draft in the studio", made.ok, JSON.stringify(made));
    const { offeringId, versionId } = made as any; offerings.push(offeringId);
    const saved = await saveDraft(admin, author, versionId, { content: ecg(comp.id, `ECG Interpretation (harness ${stamp})`), responsibilities: { contentOwnerId: P, deliveryProviderId: P, certificateIssuerId: P, commercialProviderId: P } });
    ok("A1b. the no-code draft saves with no problems left", saved.ok && (saved as any).problems.length === 0, JSON.stringify((saved as any).problems ?? saved));
    const links = (await admin.from("learning_offering_version_outcome").select("competency_id, relation").eq("version_id", versionId)).data ?? [];
    ok("A2. its objectives map to the CFCA competency, with distinct relations", links.length === 2 && links.every((l: any) => l.competency_id === comp.id) && new Set(links.map((l: any) => l.relation)).size === 2, JSON.stringify(links));
    const sub = await submitVersion(admin, author, versionId);
    ok("A3a. submission puts it forward through the one clinical-approval process", sub.ok && !!(sub as any).reviewVersionId, JSON.stringify(sub));
    const ccv = (sub as any).reviewVersionId;
    const auth = await authoriseCertificates(admin, issuer, versionId, ["course_completion", "assessed_knowledge"], "harness");
    const authByAuthor = await authoriseCertificates(admin, author, versionId, ["course_completion"], null);
    ok("A3b. certificate issuance is a separate authority: the author is refused, the issuer authorises", auth.ok && !authByAuthor.ok, JSON.stringify({ auth, authByAuthor }));
    const early = await publishVersion(admin, pub, versionId);
    const selfReview = await decideReview(admin, ccv, author, revAppt, "approved", null);
    const approve = await decideReview(admin, ccv, rev, revAppt, "approved", null);
    const authorPub = await publishVersion(admin, author, versionId);
    const published = await publishVersion(admin, pub, versionId);
    ok("A3c. nothing publishes before independent approval, the author cannot approve or publish, and someone else publishes", !early.ok && !selfReview.ok && approve.ok && !authorPub.ok && published.ok,
      JSON.stringify({ early, selfReview, approve, authorPub, published }));

    // ── A4-A6: discovery, access, verified purchase ──
    const cat = await publishedCatalogue(admin, { competencyId: comp.id });
    const item = (cat ?? []).find(i => i.offeringId === offeringId);
    ok("A4. the learner discovers it in the catalogue, filtered by its CFCA competency, as clinically reviewed", !!item && item.clinicallyApproved && item.access === "paid", JSON.stringify(item ?? cat));
    const prop = await proposePrice(admin, author, { offeringId, currency: "UGX", amountMajor: 25000, accessDays: 365, note: "staging illustration, not an approved price (D7)" });
    const selfPrice = prop.ok ? await decidePrice(admin, author, (prop as any).priceId, true, null) : prop;
    const okPrice = prop.ok ? await decidePrice(admin, pricer, (prop as any).priceId, true, null) : prop;
    ok("A5a. a staging price is proposed by the author and approved only by a different price approver", prop.ok && !selfPrice.ok && okPrice.ok, JSON.stringify({ prop, selfPrice, okPrice }));
    const priceId = (prop as any).priceId;
    const noAccess = await enrol(admin, learner, offeringId);
    ok("A5b. paid access is enforced: no entitlement, no enrolment (and no subscription is asked for)", !noAccess.ok && (noAccess as any).status === 402, JSON.stringify(noAccess));
    const p = (await admin.from("learning_offering_price").select("*").eq("id", priceId).single()).data;
    const bad = await admin.from("individual_checkout").insert({ user_id: learner, item_kind: "course", offering_id: offeringId, offering_price_id: priceId, amount_minor: 1, currency: "UGX", interval_days: 365, terms_version: p.terms_version, operating_entity: p.operating_entity, tx_ref: `lrn-harness-${stamp}-x`, status: "pending" });
    const co = await admin.from("individual_checkout").insert({ user_id: learner, item_kind: "course", offering_id: offeringId, offering_price_id: priceId, amount_minor: p.amount_minor, currency: p.currency, interval_days: p.access_days, terms_version: p.terms_version, operating_entity: p.operating_entity, tx_ref: `lrn-harness-${stamp}-1`, status: "paid" })
      .select(LEARNING_SETTLEMENT.checkoutColumns).single();
    ok("A6a. a course checkout must copy its approved price exactly", !!bad.error && !co.error, JSON.stringify({ bad: bad.error?.message, co: co.error?.message }));
    const v = { ok: true as const, amountMajor: 25000, currency: "UGX", status: "successful", txRef: `lrn-harness-${stamp}-1`, providerTxId: `harness-lrn-${stamp}`, channel: "mobile_money" };
    await LEARNING_SETTLEMENT.onPaid(admin, co.data, v as any, v.txRef, new Date());
    await LEARNING_SETTLEMENT.onPaid(admin, co.data, v as any, v.txRef, new Date());
    const ents = (await admin.from("individual_course_entitlement").select("id, source, checkout_id, ends_at").eq("user_id", learner).eq("offering_id", offeringId)).data ?? [];
    const claim1 = await admin.from("individual_checkout_event").insert({ provider: "flutterwave", provider_event_id: `harness-lrn-${stamp}`, tx_ref: v.txRef, verdict: "applied" });
    const claim2 = await admin.from("individual_checkout_event").insert({ provider: "flutterwave", provider_event_id: `harness-lrn-${stamp}`, tx_ref: v.txRef, verdict: "duplicate" });
    const exp = (await admin.from("individual_entitlement").select("id").eq("user_id", learner)).data ?? [];
    ok("A6b. a verified payment opens ONE course entitlement, a redelivery opens no second one, and no experience is granted", ents.length === 1 && ents[0].source === "payment" && !claim1.error && !!claim2.error && exp.length === 0,
      JSON.stringify({ ents, claim2: claim2.error?.message, exp }));

    // ── A7-A10: learn, complete, record, certificates, Professional and Passport ──
    const e1 = await enrol(admin, learner, offeringId);
    ok("A7a. the course-only member enrols on the verified entitlement", e1.ok, JSON.stringify(e1));
    const rid = (e1 as any).recordId;
    const l1 = await completeActivity(admin, learner, rid, "l1");
    const wrong = await answerCheck(admin, learner, rid, "q1", { "q1-1": ["b"] });
    const right = await answerCheck(admin, learner, rid, "q1", { "q1-1": ["a"] });
    ok("A7b. lessons and a deterministic check: a wrong answer fails without revealing the key, the right one completes the course", l1.ok && !l1.completed && wrong.ok && !(wrong as any).passed && (wrong as any).feedback[0].correctIds === null && right.ok && (right as any).passed && (right as any).completed,
      JSON.stringify({ l1, wrong, right }));
    const rec = (await admin.from("learning_record").select("status, completion_kind, evidence_class, version_id").eq("id", rid).single()).data;
    ok("A8. completion creates one authoritative record, platform-recorded, as assessed knowledge, pinned to its version", rec?.status === "completed" && rec.completion_kind === "assessed_knowledge" && rec.evidence_class === "platform_recorded" && rec.version_id === versionId, JSON.stringify(rec));
    const refs = await loadLearningRecords(admin, learner);
    const cpd = learningCpdLines(refs ?? []);
    const dup = (await admin.from("individual_professional_cpd").select("id").eq("user_id", learner)).data ?? [];
    ok("A9. Professional reads it by reference as CPD and competency evidence, with nothing copied into its own tables", (refs ?? []).length === 1 && cpd[0]?.hours === 1 && refs![0].competencies.some(c => c.id === comp.id) && dup.length === 0, JSON.stringify({ refs, dup }));
    const certs = (await admin.from("learning_certificate").select("certificate_no, outcome, verification_code").eq("user_id", learner)).data ?? [];
    const pass1 = learningPassportItems(refs ?? []);
    const ver = certs[0] ? await verifyCertificate(admin, certs[0].verification_code) : null;
    ok("A10. certificates for course completion and assessed knowledge are issued, verify publicly, and the Passport never says verified",
      certs.length === 2 && new Set(certs.map((c: any) => c.outcome)).size === 2 && !!ver && !ver.revoked && ver.snapshot.issuer && !/verified/i.test(JSON.stringify(pass1)), JSON.stringify({ certs, ver, pass1 }));

    // ── A15: history outlives access ──
    await admin.from("individual_course_entitlement").update({ status: "cancelled" }).eq("id", ents[0]?.id);
    const after = await myRecords(admin, learner);
    const relearn = await completeActivity(admin, learner, rid, "l1");
    ok("A15. ending the course entitlement keeps the completed record and its certificates", (after ?? []).some(r => r.id === rid && r.status === "completed" && r.certificates.length === 2) && !relearn.ok, JSON.stringify({ after, relearn }));

    // ── B: an external listing ──
    const ext = await createProvider(admin, author, { code: `HARNESS-EXT-${stamp}`, name: "External provider (harness)", kind: "external", websiteUrl: "https://provider.example" });
    const E = (ext as any).providerId;
    const mk = await createOffering(admin, author, { code: `LRN-HARNESS-EXT-${stamp}`, title: `ACLS (external, harness ${stamp})`, source: "external", delivery: "external", offeringType: "course",
      responsibilities: { contentOwnerId: E, deliveryProviderId: E, certificateIssuerId: null, commercialProviderId: E } });
    const eoff = (mk as any).offeringId, ev = (mk as any).versionId; offerings.push(eoff);
    const eb = externalTemplate(`ACLS (external, harness ${stamp})`);
    eb.summary = "An externally provided advanced life support course, listed so learners can find and record it. Staging fixture.";
    eb.objectives = [{ id: "obj-1", text: "Lead an adult resuscitation", outcomeRefs: [{ competencyId: comp.id, index: -1, relation: "practises" }] }];
    eb.external = { ...eb.external!, url: "https://provider.example/acls", providerNote: "Take it at the provider, then come back to record it.", reviewDueOn: "2027-04-01" };
    const es = await saveDraft(admin, author, ev, { content: eb });
    const esub = await submitVersion(admin, author, ev);
    const eccv = (await admin.from("clinical_content_version").select("id").eq("learning_version_id", ev)).data ?? [];
    const epub = await publishVersion(admin, pub, ev);
    const ecat = (await publishedCatalogue(admin, { delivery: "external" }) ?? []).find(i => i.offeringId === eoff);
    ok("B1. an external listing is approved on the listing route only -- no clinical review record -- and is never shown as clinically approved",
      mk.ok && es.ok && esub.ok && eccv.length === 0 && epub.ok && !!ecat && ecat.listingApproved && !ecat.clinicallyApproved && ecat.external?.url === "https://provider.example/acls", JSON.stringify({ mk, es, esub, eccv, epub, ecat }));
    const x1 = await enrol(admin, learner, eoff), x2 = await enrol(admin, learner2, eoff);
    const r1 = await recordExternalCompletion(admin, learner, (x1 as any).recordId, { completedOn: new Date().toISOString().slice(0, 10), hours: "8", reflection: "Harness", file: null });
    const pdf = new File([Buffer.from("%PDF-1.4\n% harness\n")], "certificate.pdf", { type: "application/pdf" });
    const r2 = await recordExternalCompletion(admin, learner2, (x2 as any).recordId, { completedOn: new Date().toISOString().slice(0, 10), hours: "", reflection: "", file: pdf });
    const xs = (await admin.from("learning_record").select("user_id, evidence_class, completion_kind").eq("offering_id", eoff)).data ?? [];
    ok("B2. the learner opens it and records completion -- self-declared, or source-linked with a document", x1.ok && x2.ok && r1.ok && r2.ok
      && xs.some((r: any) => r.user_id === learner && r.evidence_class === "self_declared") && xs.some((r: any) => r.user_id === learner2 && r.evidence_class === "source_linked"), JSON.stringify({ x1, r1, r2, xs }));
    const xref = await loadLearningRecords(admin, learner2);
    ok("B3. external evidence is never labelled verified, and Professional references it with its own hours (none given)", (xref ?? []).length === 1 && !/verified/i.test(JSON.stringify(learningPassportItems(xref ?? []))) && xref![0].hours === null, JSON.stringify(xref));

    // ── X: no AI anywhere ──
    const ai1 = await aiRows(people);
    ok("X1. the whole journey made no AI call (stored content and deterministic checks only)", ai0 !== null && ai1 === ai0, JSON.stringify({ ai0, ai1 }));
  } finally {
    for (const o of offerings) await retireOffering(admin, o);
    if (prior) await admin.from("practice_platform_flags").upsert(prior, { onConflict: "flag" });
    else await admin.from("practice_platform_flags").delete().eq("flag", LEARNING_APP_FLAG);
    await cleanup();
  }
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed${fails.length ? `: ${fails.join(", ")}` : ""}`);
  if (fails.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
