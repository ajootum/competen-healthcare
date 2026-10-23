/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN-CONFIG-002 ACCEPTANCE -- the Competen Individual policy, end to end, on STAGING.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only individual-config-acceptance-harness
 *     with BASE_URL=http://localhost:<port> naming a dev server that is itself pointed at STAGING.
 *
 * WHAT IT PROVES, AND HOW.
 *   K  the HQ resolver: an appointed Individual Product Administrator holds hq.individual.config.manage
 *      (migration 376) and nothing beyond the position, and a person with no appointment holds nothing.
 *   H  over HTTP, with real session cookies, against /api/hq/individual/config and the page:
 *      no session is 401, a non-holder is 403 and sees no page, a holder is refused (422) past every hard
 *      limit and on individual_app, a draft is not effective until published, rollback restores exactly
 *      and refuses a version from another scope, and every action is in the WCE audit trail.
 *   C  a value written straight into the store past its limit is clamped by the reader.
 *   Z  every fixture, appointment, override, version and audit row it made is removed, the partition is
 *      back to its pre-run rows, and individual_app is untouched.
 *
 * ⚠ THE HTTP GROUPS NEED A SERVER AND SAY SO. Without BASE_URL they print PEND and the run is not
 * acceptance. BASE_URL has no default: :3000 is usually a PRODUCTION-pointed dev server here.
 *
 * Refuses production via assertSafeTarget. PEND (exit 0, nothing created) until migration 376 is applied.
 * Creates and deletes its own harness-cfg002-* identities.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { resolveHqPositions } from "../src/lib/hq/context";
import { DEFAULT_POLICY, POLICY_SCOPE, loadIndividualPolicy, policyPath } from "../src/lib/individual/policy";
import { INDIVIDUAL_APP_FLAG } from "../src/lib/individual/gate";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "individual-config-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
const pend = (name: string, why: string) => console.log(`  PEND  ${name} -- ${why}`);

const CAP = "hq.individual.config.manage";
const POSITION = "individual_product_administrator";
const FIX = { holder: "harness-cfg002-holder@competen.test", nonholder: "harness-cfg002-nonholder@competen.test" };
const FIX_PASSWORD = `cfg002-${Math.random().toString(36).slice(2)}-Aa1!`;
const part = (q: any) => q.eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef);

async function findUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}

async function cleanupFixtures() {
  for (const email of Object.values(FIX)) {
    const u = await findUser(email);
    if (!u) continue;
    await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
    await admin.from("platform_membership").delete().eq("user_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

async function cookieFor(email: string): Promise<string | null> {
  const { data } = await createClient(url!, anonKey!, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password: FIX_PASSWORD });
  if (!data?.session) return null;
  return `sb-${new URL(url!).hostname.split(".")[0]}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`;
}

const post = (cookie: string | null, body: unknown) => fetch(`${BASE}/api/hq/individual/config`, {
  method: "POST", redirect: "manual",
  headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
});
const page = (cookie: string) => fetch(`${BASE}/super-admin/individual/configuration`, { redirect: "manual", headers: { Cookie: cookie } });

async function main() {
  console.log(`INDIVIDUAL CONFIG ACCEPTANCE (COMPETEN-CONFIG-002) -- target ${ref}${BASE ? `, server ${BASE}` : ", no server"}\n`);

  const cap = await admin.from("hq_capability").select("code").eq("code", CAP).maybeSingle();
  if (!cap.data) { console.log(`  PEND  migration 376 is not applied here (${CAP} absent). Nothing created.`); process.exit(0); }

  const flagBefore = await admin.from("practice_platform_flags").select("flag, enabled, updated_at").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
  const pre = await part(admin.from("workspace_config_overrides").select("*"));
  if (pre.error) { ok("0. the WCE store is readable", false, pre.error.message); return; }
  const preRows: any[] = pre.data ?? [];
  // ⚠ NO CLOCK IN THE CLEANUP. Rows this run made are found by the fixture ids that made them, never by
  // comparing an app-clock timestamp with a database one.
  const preVersions = (await part(admin.from("workspace_config_versions").select("id"))).data?.length ?? 0;

  await cleanupFixtures();
  const made: Record<string, string> = {};
  try {
    for (const [k, email] of Object.entries(FIX)) {
      const { data, error } = await admin.auth.admin.createUser({ email, password: FIX_PASSWORD, email_confirm: true, user_metadata: { full_name: `Harness CFG002 ${k}`, synthetic: true } });
      if (error || !data?.user) { ok(`0. fixture ${k} created`, false, error?.message); return; }
      made[k] = data.user.id;
      await admin.from("platform_membership").insert({ user_id: data.user.id, status: "active", source: "admin_grant", note: "COMPETEN-CONFIG-002 acceptance fixture. Staging only." });
    }
    const office = await admin.from("ogs_offices").select("id").eq("office_type", "hq_platform").limit(1).maybeSingle();
    if (!office.data) { ok("0. an hq_platform office exists to appoint into", false); return; }
    const appt = await admin.from("ogs_office_appointments").insert({
      office_id: office.data.id, person_id: made.holder, person_name: "Harness CFG002 holder",
      role: POSITION, status: "active", term_start: new Date(Date.now() - 60_000).toISOString(),
    });
    ok("0. the holder fixture is appointed to the Individual Product Administrator position", !appt.error, appt.error?.message);

    // ── K. the resolver ──
    const h = await resolveHqPositions(admin, made.holder);
    const n = await resolveHqPositions(admin, made.nonholder);
    ok("K1. an appointed Individual Product Administrator holds hq.individual.config.manage", h.capabilities.includes(CAP), h.capabilities.join(","));
    ok("K2. ⚠ and nothing beyond the position: the HQ landing, pilot grants and this", [...h.capabilities].sort().join() === ["hq.individual.config.manage", "hq.individual.pilot.grant", "hq.platform.home.view"].join(), h.capabilities.join(","));
    ok("K3. ⚠ a person with no appointment holds no HQ capability", n.capabilities.length === 0, n.capabilities.join(","));

    // ── C. the reader clamps whatever is stored ──
    const qPath = policyPath("scholar_questions_per_request");
    await admin.from("workspace_config_overrides").upsert({ scope_type: "platform", scope_ref: "individual", config_path: qPath, draft: { value: 99 }, published: { value: 99 } }, { onConflict: "scope_type,scope_ref,config_path" });
    ok("C1. ⚠ a value stored past its hard limit is clamped on read (99 → 3)", (await loadIndividualPolicy(admin)).scholarQuestionsPerRequest === 3);
    await admin.from("workspace_config_overrides").delete().eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", qPath);

    // ── H. over HTTP ──
    if (!BASE) {
      pend("H. the route and the page over HTTP", "BASE_URL is not set: start a STAGING-pointed dev server and pass BASE_URL. This run is NOT acceptance.");
      return;
    }
    const holder = await cookieFor(FIX.holder), nonholder = await cookieFor(FIX.nonholder);
    if (!holder || !nonholder) { ok("H0. both fixtures can sign in", false); return; }

    const anon = await post(null, { action: "set", key: "reminder_horizon_days", value: 90 });
    // ⚠ 403, NOT 401, IS TODAY'S ESTATE-WIDE ANSWER and not this route's: resolveHqContext returns
    // redirectTo "/login?next=/super-admin" and hqApiGate tests for exactly "/login", so every hqApiGate
    // route refuses an anonymous caller with 403. A refusal either way; reported as a follow-up, not fixed here.
    ok("H1. no session is refused (401, or 403 from the estate-wide hqApiGate quirk)", anon.status === 401 || anon.status === 403, String(anon.status));
    const nh = await post(nonholder, { action: "set", key: "reminder_horizon_days", value: 90 });
    ok("H2. ⚠ a signed-in person without the capability is refused (403)", nh.status === 403, String(nh.status));
    const nhPage = await page(nonholder);
    const nhHtml = nhPage.status === 200 ? await nhPage.text() : "";
    ok("H3. ⚠ and does not see the policy page", !nhHtml.includes("Draft value") && !nhHtml.includes("Publish"), `status ${nhPage.status}`);
    const afterRefusals = await part(admin.from("workspace_config_overrides").select("config_path"));
    ok("H4. the refused writes changed nothing", (afterRefusals.data ?? []).length === preRows.length);

    const hs = async (body: unknown) => { const r = await post(holder, body); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const over = await Promise.all([
      hs({ action: "set", key: "scholar_questions_per_request", value: 4 }),
      hs({ action: "set", key: "scholar_materials_per_person", value: 51 }),
      hs({ action: "set", key: "share_link_max_days", value: 366 }),
      hs({ action: "set", key: "ai_hourly_limit", value: 31 }),
      hs({ action: "set", key: "reminder_horizon_days", value: 6 }),
      hs({ action: "set", key: "passport_achievement_kinds", value: ["practice_questions", "certificates"] }),
    ]);
    ok("H5. ⚠ the holder cannot exceed any hard limit (422 on every one)", over.every(o => o.status === 422), over.map(o => o.status).join(","));
    const app = await hs({ action: "set", key: "individual_app", value: true });
    ok("H6. ⚠ the holder cannot reach individual_app through this door", app.status === 422, String(app.status));
    const afterOver = await part(admin.from("workspace_config_overrides").select("config_path"));
    ok("H7. none of the refused values reached the store", (afterOver.data ?? []).length === preRows.length);

    const s1 = await hs({ action: "set", key: "reminder_horizon_days", value: 90 });
    ok("H8. the holder saves a draft within the limit", s1.status === 200, JSON.stringify(s1.body));
    ok("H9. a draft is not effective until published", (await loadIndividualPolicy(admin)).reminderHorizonDays === DEFAULT_POLICY.reminderHorizonDays);
    const p1 = await hs({ action: "publish", note: "harness cfg002 v1" });
    ok("H10. publishing makes it effective", p1.status === 200 && (await loadIndividualPolicy(admin)).reminderHorizonDays === 90, JSON.stringify(p1.body));

    await hs({ action: "set", key: "ai_hourly_limit", value: 5 });
    const p2 = await hs({ action: "publish", note: "harness cfg002 v2" });
    ok("H11. a second version takes effect", p2.status === 200 && (await loadIndividualPolicy(admin)).aiHourlyLimit === 5);

    const ws = await admin.from("workspace_config_versions").select("id").eq("scope_type", "platform").eq("scope_ref", "platform").limit(1).maybeSingle();
    if (ws.data) {
      const cross = await hs({ action: "rollback", versionId: ws.data.id });
      ok("H12. ⚠ a workspace version cannot be restored through the Individual door (404)", cross.status === 404, String(cross.status));
    } else pend("H12. cross-scope rollback refusal", "staging has no platform workspace version to try");

    const rb = await hs({ action: "rollback", versionId: p1.body?.versionId });
    const now = await loadIndividualPolicy(admin);
    ok("H13. rollback restores exactly: the lead time stays 90 and the later AI limit returns to its default",
      rb.status === 200 && now.reminderHorizonDays === 90 && now.aiHourlyLimit === DEFAULT_POLICY.aiHourlyLimit, JSON.stringify({ rb: rb.body, now }));

    const hp = await page(holder);
    const html = hp.status === 200 ? await hp.text() : "";
    ok("H14. the holder sees the page: the effective value, the fixed limit and the versions",
      html.includes("Individual policy") && html.includes("90 days") && html.includes("7 to 180 days") && html.includes("harness cfg002 v1"), `status ${hp.status}`);

    const trail = await part(admin.from("workspace_config_audit").select("action")).eq("actor_id", made.holder);
    const mine = (trail.data ?? []).map((a: any) => a.action);
    ok("H15. every holder action is in the WCE audit trail under the holder's id",
      ["set", "publish", "rollback"].every(a => mine.includes(a)) && mine.length >= 5, mine.join(","));
  } finally {
    // ── Z. restore ──
    await part(admin.from("workspace_config_overrides").delete());
    if (preRows.length) await admin.from("workspace_config_overrides").insert(preRows);
    const ids = Object.values(made);
    if (ids.length) {
      await part(admin.from("workspace_config_versions").delete()).in("published_by", ids);
      await part(admin.from("workspace_config_audit").delete()).in("actor_id", ids);
    }
    await cleanupFixtures();
    const byPath = (rows: any[]) => JSON.stringify([...rows].sort((a, b) => a.config_path.localeCompare(b.config_path)));
    const post_ = await part(admin.from("workspace_config_overrides").select("*"));
    ok("Z1. the Individual partition is back to its pre-run rows", byPath(post_.data ?? []) === byPath(preRows));
    const left = await part(admin.from("workspace_config_versions").select("id"));
    ok("Z2. no version made by this run is left", (left.data ?? []).length === preVersions, `${(left.data ?? []).length} vs ${preVersions}`);
    ok("Z3. fixtures removed", !(await findUser(FIX.holder)) && !(await findUser(FIX.nonholder)));
    const flagAfter = await admin.from("practice_platform_flags").select("flag, enabled, updated_at").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
    ok("Z4. ⚠ individual_app was not touched", JSON.stringify(flagAfter.data) === JSON.stringify(flagBefore.data));
  }
}

function finish(): never {
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}

main().then(() => finish(), async e => { console.error(e); await cleanupFixtures().catch(() => {}); process.exit(1); });
