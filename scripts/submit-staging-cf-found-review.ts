/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OWNER GO "COMPETEN IND-007 -- CF-FOUND STAGING SUBMISSION GO" (Option B, 24 October 2026), STAGING ONLY.
 *
 *   BASE_URL=http://localhost:3040 npx tsx scripts/submit-staging-cf-found-review.ts
 *
 * BASE_URL must be a dev server pointed at STAGING (npm run dev:staging, or the IND-007 staging launcher). It has no
 * default: :3000 is usually a production-pointed server here.
 *
 * What it does, in order:
 *   1. Creates ONE temporary synthetic staging actor, "CF-FOUND curator (synthetic staging fixture, IND-007)", at
 *      cf-found-curator@staging.competen.invalid. It is not the product owner and not a clinical reviewer.
 *   2. Grants the MINIMUM to submit: an active platform membership, and an appointment to the Individual Product
 *      Administrator position (hq.individual.config.manage, the curator gate). NOT super_admin. The appointment is
 *      a staging fixture insert, as the individual-config acceptance does, because the appointment route itself
 *      needs an owner session. The position's grants come from hq_position_capability, untouched.
 *   3. Signs in as that actor and puts each of the eight CF-FOUND entries of the review carrier forward through the
 *      REAL route, POST /api/hq/individual/catalogues {action: "review"}, over HTTP. The route's capability gate,
 *      the 394/395 triggers and submitForReview decide. Nothing is inserted into the review tables directly.
 *   4. Verifies each version is in the clinical review queue, with the actor as submitter and author.
 *   5. Retires the actor: ends the appointment (kept as the record), revokes the membership, bans the account, and
 *      revokes its sessions. Then proves access is gone: sign-in is refused, and the old session is refused by the
 *      route. The account and every row naming it are KEPT, so the attribution stays true.
 *
 * It never approves, publishes, or writes ai_model_eligibility or clinical_review_decision.
 */
import { loadEnvConfig } from "@next/env";
import { appointmentAuthority, fixtureOwnerId } from "./_hq-fixture-authority";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { judgeTarget } from "./production-guard";
import { loadClinicalReviews, CLINICAL_STATE_LABEL } from "../src/lib/competency/clinical-review";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "", anon = process.env.STAGING_ANON_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key || !anon) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "missing key" : verdict.reason}).`); process.exit(1); }
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (!/^http:\/\/localhost:\d+$/.test(BASE)) { console.error("REFUSING: BASE_URL must be a local staging-pointed dev server, e.g. http://localhost:3040."); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const EMAIL = "cf-found-curator@staging.competen.invalid";
const NAME = "CF-FOUND curator (synthetic staging fixture, IND-007 -- not the product owner, not a clinical reviewer)";
const PURPOSE = "Owner GO 'CF-FOUND STAGING SUBMISSION GO' (Option B), 2026-10-24: temporary synthetic staging actor to put the eight CF-FOUND entries forward for clinical review through the governed route. Staging only. Retired after.";
const PASSWORD = `${randomBytes(18).toString("base64url")}-Aa1!`;
const POSITION = "individual_product_administrator";
const log: string[] = [];
const say = (s: string) => { log.push(s); console.log(s); };

async function findUser() {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === EMAIL);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
const cookieOf = (session: any) => `sb-${new URL(url).hostname.split(".")[0]}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;

async function main() {
  const HQ_OWNER = await fixtureOwnerId(admin);
  say(`CF-FOUND staging submission -- target ${(verdict as any).ref}, server ${BASE}`);
  if (await findUser()) { console.error(`REFUSING: ${EMAIL} already exists. This GO creates one temporary actor, once. Nothing changed.`); process.exit(1); }
  const carrier = (await admin.from("frameworks").select("id, code, pub_status").is("hospital_id", null).eq("code", "CF-FOUND-RC").maybeSingle()).data;
  if (!carrier || carrier.pub_status !== "draft") { console.error("REFUSING: the CF-FOUND review carrier is missing or not a draft."); process.exit(1); }
  const entries = (await admin.from("competency_catalogue_entry").select("id, competency_id").eq("catalogue_id", carrier.id)).data ?? [];
  const comps = (await admin.from("framework_competencies").select("id, code").in("id", entries.map((e: any) => e.competency_id))).data ?? [];
  const codeOf = new Map(comps.map((c: any) => [c.id, c.code]));
  if (entries.length !== 8) { console.error(`REFUSING: the carrier names ${entries.length} entries, not 8.`); process.exit(1); }

  // 1-2. The actor, with the minimum grant.
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { full_name: NAME, synthetic: true, purpose: PURPOSE } });
  if (cErr || !created?.user) throw new Error(`createUser: ${cErr?.message}`);
  const uid = created.user.id as string;
  await admin.from("profiles").update({ full_name: NAME }).eq("id", uid);
  const mem = await admin.from("platform_membership").insert({ user_id: uid, status: "active", source: "admin_grant", note: PURPOSE }).select("id").single();
  if (mem.error) throw new Error(`membership: ${mem.error.message}`);
  const office = (await admin.from("ogs_offices").select("id").eq("office_type", "hq_platform").limit(1).maybeSingle()).data;
  if (!office) throw new Error("no hq_platform office to appoint into");
  const appt = await admin.from("ogs_office_appointments").insert({ ...appointmentAuthority(HQ_OWNER), office_id: office.id, person_id: uid, person_name: NAME, role: POSITION, status: "active",
    term_start: new Date(Date.now() - 60_000).toISOString(), scope: "staging: CF-FOUND clinical review submission only (owner GO Option B)" }).select("id").single();
  if (appt.error) throw new Error(`appointment: ${appt.error.message}`);
  say(`actor ${uid} created; membership ${mem.data.id}; appointment ${appt.data.id} (${POSITION}, not super_admin)`);

  // 3. Sign in, and submit through the real route.
  const signed = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signed.error || !signed.data.session) throw new Error(`sign-in: ${signed.error?.message}`);
  const cookie = cookieOf(signed.data.session);
  const outcomes: { code: string; status: number; body: any }[] = [];
  for (const e of entries) {
    const res = await fetch(`${BASE}/api/hq/individual/catalogues`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ catalogueId: carrier.id, action: "review", entryId: e.id }) });
    const body = await res.json().catch(() => ({}));
    outcomes.push({ code: String(codeOf.get(e.competency_id)), status: res.status, body });
    say(`  submit ${codeOf.get(e.competency_id)}: HTTP ${res.status} ${JSON.stringify(body)}`);
  }

  // 4. The queue and the attribution.
  const versions = (await admin.from("clinical_content_version").select("id, competency_id, submitted_by, authored_by, required_approvals, risk_basis, created_at").in("competency_id", entries.map((e: any) => e.competency_id))).data ?? [];
  const reviews = await loadClinicalReviews(admin, entries.map((e: any) => e.competency_id));
  for (const e of entries) {
    const v = versions.filter((x: any) => x.competency_id === e.competency_id);
    const r = reviews?.get(e.competency_id);
    say(`  queue ${codeOf.get(e.competency_id)}: ${v.length} version(s); submitted_by actor ${v.every((x: any) => x.submitted_by === uid)}; authored_by ${JSON.stringify(v[0]?.authored_by?.map((a: string) => a === uid ? "actor" : a.slice(0, 8)))}; state ${r ? CLINICAL_STATE_LABEL[r.state] : "unread"}`);
  }
  const audits = (await admin.from("audit_log").select("action, actor_id, actor_name, entity_id").eq("actor_id", uid)).data ?? [];
  say(`  audit rows by the actor: ${audits.length} (${[...new Set(audits.map((a: any) => a.action))].join(", ")}), actor_name "${audits[0]?.actor_name ?? ""}"`);
  const decisions = (await admin.from("clinical_review_decision").select("id").in("version_id", versions.map((v: any) => v.id))).data ?? [];
  say(`  decisions on these versions: ${decisions.length} (none expected: nothing approved)`);

  // 5. Retire the actor and prove access is gone.
  await admin.from("ogs_office_appointments").update({ status: "removed", term_end: new Date().toISOString() }).eq("id", appt.data.id);
  await admin.from("platform_membership").update({ status: "revoked", revoked_at: new Date().toISOString(), note: `${PURPOSE} Revoked after submission.` }).eq("id", mem.data.id);
  await admin.from("profiles").update({ role: null, roles: [] }).eq("id", uid);
  // Sessions are revoked BEFORE the ban: once banned, the sign-out call itself is refused ("User is banned"), which
  // is what the first run on 24 October 2026 recorded (its sessions were refused anyway: 401 on the route).
  const so = await admin.auth.admin.signOut(signed.data.session.access_token, "global");
  await admin.auth.admin.updateUserById(uid, { ban_duration: "876000h", user_metadata: { full_name: NAME, synthetic: true, purpose: PURPOSE, retired: new Date().toISOString() } });
  say(`retired: appointment removed, membership revoked, roles cleared, banned until ~2126, sessions revoked (${so.error ? `signOut error ${so.error.message}` : "ok"})`);
  const again = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const stale = await fetch(`${BASE}/api/hq/individual/catalogues`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ catalogueId: carrier.id, action: "review", entryId: entries[0].id }) });
  const apptNow = (await admin.from("ogs_office_appointments").select("status").eq("id", appt.data.id).single()).data;
  const memNow = (await admin.from("platform_membership").select("status").eq("id", mem.data.id).single()).data;
  say(`access check: sign-in ${again.error ? `refused (${again.error.message})` : "ALLOWED -- NOT RETIRED"}; old session on the route HTTP ${stale.status}; appointment ${apptNow?.status}; membership ${memNow?.status}`);
  const ok = outcomes.every(o => o.status === 200) && !!again.error && stale.status >= 400 && apptNow?.status === "removed" && memNow?.status === "revoked" && decisions.length === 0;
  say(ok ? "COMPLETE: 8 submitted through the governed route, the actor retired, access refused." : "INCOMPLETE: see the lines above.");
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error(e.message ?? e); process.exit(1); });
