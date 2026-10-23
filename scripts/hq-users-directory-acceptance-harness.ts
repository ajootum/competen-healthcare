/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HQ-USERS-C ACCEPTANCE -- the HQ user directory against real rows, on STAGING.
 *
 *   BASE_URL=http://localhost:<port> npx tsx scripts/privileged-harnesses.ts --staging --only hq-users-directory-acceptance-harness
 *
 * Fixtures (harness-usersc-*): a VIEWER appointed platform_director (hq.platform.users.view); a SUBJECT with
 * platform membership, an Individual membership and a live Professional entitlement, and an HQ appointment
 * as chief_financial_officer; a STRANGER with nothing.
 *   A  the loader (src/lib/hq/user-directory.ts) reports exactly those facts for the subject, every source
 *      readable, and the stranger with no access and no HQ position
 *   H  over HTTP: the viewer opens the directory and finds the subject, a stranger does not get it
 *   Z  fixtures, appointments, memberships and entitlements removed
 *
 * Refuses production via assertSafeTarget. Creates and deletes its own harness-usersc-* identities.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { activeProducts, holdsHqPosition, loadDirectoryAccess } from "../src/lib/hq/user-directory";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "hq-users-directory-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);

const FIX = { viewer: "harness-usersc-viewer@competen.test", subject: "harness-usersc-subject@competen.test", stranger: "harness-usersc-stranger@competen.test" };
const PASSWORD = `usersC-${Math.random().toString(36).slice(2)}-Aa1!`;

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
  for (const email of Object.values(FIX)) {
    const u = await findUser(email);
    if (!u) continue;
    await admin.from("individual_entitlement").delete().eq("user_id", u.id);
    await admin.from("individual_membership").delete().eq("user_id", u.id);
    await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
    await admin.from("platform_membership").delete().eq("user_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}
async function cookieFor(email: string) {
  const { data } = await createClient(url!, anonKey!, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password: PASSWORD });
  return data?.session ? `sb-${new URL(url!).hostname.split(".")[0]}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}` : null;
}

async function main() {
  console.log(`HQ USERS DIRECTORY ACCEPTANCE (HQ-USERS-C) -- target ${ref}${BASE ? `, server ${BASE}` : ", no server"}\n`);
  await cleanup();
  const id: Record<string, string> = {};
  try {
    for (const [k, email] of Object.entries(FIX)) {
      const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: `Harness usersC ${k}`, synthetic: true } });
      if (error || !data?.user) { ok(`0. fixture ${k}`, false, error?.message); return; }
      id[k] = data.user.id;
    }
    for (const k of ["viewer", "subject"]) await admin.from("platform_membership").insert({ user_id: id[k], status: "active", source: "admin_grant", note: "HQ-USERS-C acceptance fixture. Staging only." });
    const office = await admin.from("ogs_offices").select("id, office_type").like("office_type", "hq_%");
    const officeFor = (type: string) => (office.data ?? []).find((o: any) => o.office_type === type)?.id;
    const appts = await admin.from("ogs_office_appointments").insert([
      { office_id: officeFor("hq_platform"), person_id: id.viewer, person_name: "Harness usersC viewer", role: "platform_director", status: "active", term_start: new Date(Date.now() - 60_000).toISOString() },
      { office_id: officeFor("hq_executive"), person_id: id.subject, person_name: "Harness usersC subject", role: "chief_financial_officer", status: "active", term_start: new Date(Date.now() - 60_000).toISOString() },
    ]);
    const im = await admin.from("individual_membership").insert({ user_id: id.subject, status: "active", source: "hq_pilot_grant" });
    const ie = await admin.from("individual_entitlement").insert({ user_id: id.subject, experience_code: "professional", status: "active", source: "pilot", operating_entity: "competen_holdings" });
    ok("0. fixtures: appointments, Individual membership and a live Professional entitlement", !appts.error && !im.error && !ie.error, [appts.error?.message, im.error?.message, ie.error?.message].filter(Boolean).join(" | "));

    // ── A. the loader, against real rows ──
    const dir = await loadDirectoryAccess(admin);
    ok("A1. every source answered on staging", Object.values(dir.readable).every(Boolean), JSON.stringify(dir.readable));
    const s = dir.byUser.get(id.subject);
    ok("A2. the subject: platform active, Individual active with Professional live", !!s && s.platform === "active" && s.individual.membership === "active" && s.individual.live.includes("professional"), JSON.stringify(s));
    ok("A3. the subject's HQ position is named from hq_position, and counts as active", !!s && s.hq.some(h => h.position === "chief_financial_officer" && h.status === "active" && !!h.name) && holdsHqPosition(s), JSON.stringify(s?.hq));
    ok("A4. the product filter values for the subject", !!s && JSON.stringify(activeProducts(s)) === JSON.stringify(["platform", "individual"]), JSON.stringify(s && activeProducts(s)));
    const t = dir.byUser.get(id.stranger);
    ok("A5. the stranger has no access and no HQ position (absent from every source)", !t || (activeProducts(t).length === 0 && !holdsHqPosition(t)));

    // ── H. over HTTP ──
    if (!BASE) { pend("H. the page over HTTP", "BASE_URL is not set"); return; }
    const viewer = await cookieFor(FIX.viewer), stranger = await cookieFor(FIX.stranger);
    if (!viewer || !stranger) { ok("H0. fixtures sign in", false); return; }
    const page = await fetch(`${BASE}/super-admin/users`, { redirect: "manual", headers: { Cookie: viewer } });
    const html = page.status === 200 ? await page.text() : "";
    ok("H1. the viewer opens the directory, with its product and HQ filters, and the subject is listed", page.status === 200 && html.includes("Product: Any") && html.includes("HQ position: Any") && html.includes(FIX.subject), String(page.status));
    ok("H2. ⚠ the page payload carries no patient or record content for the subject", !/practice_patient|given_name|cpd_hours|reflection|evidence_class/.test(html));
    const sp = await fetch(`${BASE}/super-admin/users`, { redirect: "manual", headers: { Cookie: stranger } });
    const shtml = sp.status === 200 ? await sp.text() : "";
    ok("H3. ⚠ a person with no HQ position gets no directory", sp.status !== 200 || (!shtml.includes(FIX.subject) && !shtml.includes("Product: Any")), String(sp.status));
  } finally {
    await cleanup();
    ok("Z1. fixtures and their rows removed", !(await findUser(FIX.subject)) && !(await findUser(FIX.viewer)) && !(await findUser(FIX.stranger)));
  }
}

main().then(() => {
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}, async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
