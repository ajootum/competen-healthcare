/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * INDIVIDUAL ACCEPTANCE HARNESS -- COMPETEN-IND-003 s5, against a real database, STAGING ONLY.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS EXISTS TO KEEP TRUE (the brief's acceptance list, one assertion group each).
 *
 *   A. One person holds BOTH experiences through authorised entitlements, and the neutral sign-in
 *      offers Competen Individual -- and NOT the estate, which they do not hold.
 *   B. A person entitled to ONE experience sees only that one. Direct Professional entry needs no
 *      Scholar row, ever.
 *   C. Liveness is the DATABASE clock: a period that has ended or not yet started is not live, even
 *      with status `active`. This is the control for A and B -- without it "live" could mean "any row".
 *   D. Graduation ACTIVATES: adding Professional to a Scholar leaves the same user id, the same
 *      membership row and the same Passport, and both experiences are then live.
 *   E. The primary experience is honoured only while live, and falls back when it is not.
 *   F. Nothing in any of this creates another product's membership or writes profiles.role.
 *   G. Own-row RLS (provisional ruling D6): a signed-in person reads their own membership, cannot read
 *      another's, and cannot grant themselves one.
 *   H. A suspended membership is refused.
 *
 * ⚠ IT IMPORTS THE RULES IT TESTS -- readIndividualAccess, decideLanding, effectivePrimary,
 * resolveProductDestinations, loadIndividualPassport, buildHistory. Nothing below restates them.
 *
 * ⚠ MIGRATION 370 IS APPLIED BY HAND. Until it is, every assertion reports PEND, never PASS, and the run
 * exits 0 with the count of PENDs printed -- "not applied yet" is not a failure of the code, and it is
 * not a pass either.
 *
 * ⚠ STAGING ONLY. .env.local names PRODUCTION, so this refuses to start unless the Supabase variables
 * have been remapped to staging -- run it through the privileged runner, which does exactly that:
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only individual-acceptance
 *
 * ⚠ RUN IT ALONE. Its fixture identities are its own (harness-ind003-*@competen.test) so it does not
 * collide with another harness's, but it creates and deletes auth users on the shared staging project.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { readIndividualAccess, decideLanding, effectivePrimary, isNotProvisioned } from "../src/lib/individual/access";
import { resolveProductDestinations } from "../src/lib/identity/product-resolution";
import { loadIndividualPassport } from "../src/lib/individual/passport";
import { buildHistory, loadEntitlementHistory } from "../src/lib/individual/history";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "individual-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0, pend = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const FIX = {
  both: "harness-ind003-both@competen.test",
  scholar: "harness-ind003-scholar@competen.test",
  pro: "harness-ind003-pro@competen.test",
  suspended: "harness-ind003-suspended@competen.test",
};
// A test value generated for this run, used only to sign the fixture in for the RLS check (G).
const FIX_PASSWORD = `ind003-${Math.random().toString(36).slice(2)}-Aa1!`;

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
  for (const email of Object.values(FIX)) {
    const u = await findUser(email);
    if (!u) continue;
    await admin.from("individual_entitlement").delete().eq("user_id", u.id);
    await admin.from("individual_membership").delete().eq("user_id", u.id);
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: FIX_PASSWORD, email_confirm: true });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id as string;
}

// The HQ pilot grant, exactly as COMPETEN-IND-003 s6's SQL template writes it.
async function grant(userId: string, experiences: { code: "scholar" | "professional"; source?: string; starts?: string; ends?: string | null }[], status = "active") {
  const m = await admin.from("individual_membership").insert({ user_id: userId, status, source: "hq_pilot_grant" });
  if (m.error) throw new Error(`membership: ${m.error.message}`);
  for (const e of experiences) {
    const r = await admin.from("individual_entitlement").insert({
      user_id: userId, experience_code: e.code, source: e.source ?? "pilot",
      operating_entity: e.code === "scholar" ? "scholar_operator" : "competen_holdings",
      ...(e.starts ? { starts_at: e.starts } : {}), ...(e.ends !== undefined ? { ends_at: e.ends } : {}),
    });
    if (r.error) throw new Error(`entitlement ${e.code}: ${r.error.message}`);
  }
}

async function main() {
  console.log(`\nIndividual acceptance harness -- COMPETEN-IND-003 s5 -- target ${ref}\n`);

  const probe = await admin.from("individual_membership").select("id").limit(1);
  if (probe.error && isNotProvisioned(probe.error)) {
    pend = 8;
    console.log("  PEND  A-H: migration 370 is not applied on this project. Nothing was created.");
    console.log(`\nPENDING -- 0 passed, ${pend} groups pending (apply 370, then re-run)`);
    process.exit(0);
  }
  if (probe.error) { console.error(`store unreadable: ${probe.error.message}`); process.exit(1); }

  await cleanup();
  const day = 86400000;
  const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();

  const both = await makeUser(FIX.both);
  const scholar = await makeUser(FIX.scholar);
  const pro = await makeUser(FIX.pro);
  const suspended = await makeUser(FIX.suspended);

  // Ended and not-yet-started periods ride along on the "both" person as the C control.
  await grant(both, [
    { code: "scholar" }, { code: "professional" },
    { code: "scholar", starts: iso(-60), ends: iso(-30) },
    { code: "professional", starts: iso(30) },
  ]);
  await grant(scholar, [{ code: "scholar" }, { code: "professional", starts: iso(-40), ends: iso(-1) }]);
  await grant(pro, [{ code: "professional" }]);
  await grant(suspended, [{ code: "scholar" }], "suspended");

  // ── A. both experiences, and the chooser ──
  const a: any = await readIndividualAccess(admin, both);
  ok("A1. one person holds Scholar AND Professional through live entitlements", a.state === "member" && a.live.join() === "scholar,professional", JSON.stringify(a));
  const r: any = await resolveProductDestinations(admin, both);
  const codes = r.state === "one" ? [r.destination.code] : r.state === "many" ? r.destinations.map((d: any) => d.code) : [];
  ok("A2. neutral sign-in offers Competen Individual and NOT the estate they do not hold", codes.includes("individual") && !codes.includes("platform"), JSON.stringify(r));

  // ── B. one experience, direct Professional ──
  const b1: any = await readIndividualAccess(admin, scholar);
  ok("B1. a Scholar-only person sees only Scholar (their ended Professional period is not live)", b1.state === "member" && b1.live.join() === "scholar", JSON.stringify(b1));
  const b2: any = await readIndividualAccess(admin, pro);
  const proScholarRows = await admin.from("individual_entitlement").select("id").eq("user_id", pro).eq("experience_code", "scholar");
  ok("B2. direct Professional: live Professional with no Scholar row ever written", b2.live?.join() === "professional" && (proScholarRows.data ?? []).length === 0);
  ok("B3. a new member lands on the welcome first", decideLanding(b2.membership, b2.live).kind === "welcome");

  // ── C. the control: DB-clock liveness ──
  const rows = await admin.from("individual_entitlement").select("id").eq("user_id", both);
  const liveRows = await admin.from("individual_live_entitlement").select("id").eq("user_id", both);
  ok("C1. ⚠ the ledger holds 4 rows for that person but only 2 are live -- ended and future periods are excluded", (rows.data ?? []).length === 4 && (liveRows.data ?? []).length === 2, `${rows.data?.length}/${liveRows.data?.length}`);

  // ── D. graduation activates ──
  const before = await admin.from("individual_membership").select("id").eq("user_id", scholar).single();
  await admin.from("individual_entitlement").insert({ user_id: scholar, experience_code: "professional", source: "graduation", operating_entity: "competen_holdings" });
  const d: any = await readIndividualAccess(admin, scholar);
  const after = await admin.from("individual_membership").select("id").eq("user_id", scholar).single();
  ok("D1. graduation adds Professional on the SAME account and membership row; both live", d.live?.join() === "scholar,professional" && before.data?.id === after.data?.id);
  const passport = await loadIndividualPassport(admin, scholar, new Date().toISOString().slice(0, 10));
  ok("D2. the Passport reads for the graduated person (sections read, not unreadable)", passport.competencies !== null && passport.credentials !== null && passport.employment !== null);
  const hist = buildHistory({ joinedAt: d.membership.grantedAt, entitlements: await loadEntitlementHistory(admin, scholar), passport });
  ok("D3. the one history keeps the Scholar period and shows Professional activated on graduation",
    hist.some(h => h.title === "Competen Scholar started") && hist.some(h => h.title === "Competen Professional started" && h.detail === "activated on graduation"));

  // ── E. primary experience ──
  await admin.from("individual_membership").update({ primary_experience: "professional", onboarded_at: new Date().toISOString() }).eq("user_id", both);
  const e1: any = await readIndividualAccess(admin, both);
  ok("E1. a live primary experience is where they land", decideLanding(e1.membership, e1.live).kind === "experience" && (decideLanding(e1.membership, e1.live) as any).experience === "professional");
  await admin.from("individual_membership").update({ primary_experience: "professional", onboarded_at: new Date().toISOString() }).eq("user_id", scholar);
  await admin.from("individual_entitlement").update({ status: "cancelled" }).eq("user_id", scholar).eq("source", "graduation");
  const e2: any = await readIndividualAccess(admin, scholar);
  ok("E2. a primary experience that is no longer live falls back instead of stranding them", effectivePrimary(e2.membership.primaryExperience, e2.live) === "scholar");

  // ── F. no other product touched ──
  const ids = [both, scholar, pro, suspended];
  const [pm, pr, em, prof] = await Promise.all([
    admin.from("platform_membership").select("user_id").in("user_id", ids),
    admin.from("practice_membership").select("user_id").in("user_id", ids),
    admin.from("enterprise_membership").select("user_id").in("user_id", ids),
    admin.from("profiles").select("id, role").in("id", ids),
  ]);
  ok("F1. no platform, practice or enterprise membership exists for any fixture", !pm.error && !pr.error && (pm.data ?? []).length === 0 && (pr.data ?? []).length === 0 && (em.error || (em.data ?? []).length === 0));
  ok("F2. ⚠ control: the four profiles exist, and every profiles.role is still null", (prof.data ?? []).length === 4 && (prof.data ?? []).every((p: any) => p.role === null), JSON.stringify(prof.data));

  // ── G. own-row RLS ──
  const user = createClient(url!, anonKey!, { auth: { persistSession: false } }) as any;
  const signIn = await user.auth.signInWithPassword({ email: FIX.both, password: FIX_PASSWORD });
  if (signIn.error) ok("G0. the fixture can sign in for the RLS check", false, signIn.error.message);
  else {
    const own = await user.from("individual_membership").select("user_id");
    ok("G1. a signed-in person reads their own membership row, and only theirs", (own.data ?? []).length === 1 && own.data[0].user_id === both, JSON.stringify(own));
    const ownLive = await user.from("individual_live_entitlement").select("user_id");
    ok("G2. the live view honours the same policy (security_invoker)", (ownLive.data ?? []).length === 2 && (ownLive.data ?? []).every((x: any) => x.user_id === both));
    const selfGrant = await user.from("individual_entitlement").insert({ user_id: both, experience_code: "scholar", source: "pilot", operating_entity: "scholar_operator" });
    ok("G3. ⚠ a person cannot grant themselves an experience from a browser session", !!selfGrant.error);
    await user.auth.signOut();
  }

  // ── H. suspended ──
  ok("H1. a suspended membership is refused", JSON.stringify(await readIndividualAccess(admin, suspended)) === JSON.stringify({ state: "none", reason: "suspended" }));

  await cleanup();
  const left = await admin.from("individual_membership").select("id").in("user_id", ids);
  ok("Z1. fixtures removed (cascade from profiles cleared every Individual row)", (left.data ?? []).length === 0);

  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}

main().catch(async e => { console.error(e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
