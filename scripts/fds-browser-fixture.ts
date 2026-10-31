/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FRAMEWORK-DESIGN-STUDIO-01 -- STAGING BROWSER FIXTURE (idempotent). STAGING ONLY.
 *
 *   npx.cmd tsx scripts/fds-browser-fixture.ts          (run with cwd competen-p2, which holds the staging .env.local)
 *
 * Ensures, on staging only:
 *   - harness-fds-author@competen.test    Competency Author (hq.quality.competency.author). NOT a publisher.
 *   - harness-fds-publisher@competen.test a separate sign-in with no appointment, recorded as the publisher (published_by)
 *                                         so the 640 independence rule passes. It is never used to sign in.
 *   - "FDS draft framework (fixture)"      never published; 3 domains; 3 competencies in domain 1; 2 sections and
 *                                         3 criteria in one section.
 *   - "FDS published framework (fixture)"  the same shape, published once through transitionFramework (the product's path).
 * Both frameworks carry a code and NO competency layer, so the 466 clinical-approval guard (shared CFCA layered
 * frameworks only) does not apply and no clinical approval is faked.
 *
 * Writes email, password and both Studio URLs to the scratchpad file named below. The password is never printed; it is
 * reused on re-run while the file exists, and reset (new random) only if the file is gone.
 * Remove: --remove deletes the two frameworks and both users. Refuses unless STAGING_SUPABASE_URL passes production-guard.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget, judgeTarget } from "./production-guard";
import { appointmentAuthority, fixtureOwnerId } from "./_hq-fixture-authority";
import { transitionFramework } from "../src/lib/competency/framework-lifecycle";
import { HQ_OFFICE_TYPE_PREFIX } from "../src/lib/hq/spaces";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
assertSafeTarget(url, "STAGING_SUPABASE_URL");
export const admin: any = createClient(url, key, { auth: { persistSession: false } });

const OUT = "C:\\Users\\elish\\AppData\\Local\\Temp\\claude\\C--Users-elish-Documents-Competen\\a8637d9f-8e17-4384-a425-178c29a6d626\\scratchpad\\fds-browser-fixture.txt";
const AUTHOR = { email: "harness-fds-author@competen.test", name: "FDS fixture author (synthetic, staging)" };
const PUBLISHER = { email: "harness-fds-publisher@competen.test", name: "FDS fixture publisher (synthetic, staging)" };
const FW = [
  { key: "draft", name: "FDS draft framework (fixture)", code: "FDS-DRAFT-FIX", publish: false },
  { key: "published", name: "FDS published framework (fixture)", code: "FDS-PUB-FIX", publish: true },
] as const;
const BASE = "http://localhost:3100/super-admin/competencies/authoring";

export const newPassword = () => `${randomBytes(18).toString("base64url")}-Aa1!`;
export async function findUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
function savedPassword(): string | null {
  if (!existsSync(OUT)) return null;
  return /^password: (.+)$/m.exec(readFileSync(OUT, "utf8"))?.[1]?.trim() ?? null;
}
export async function ensureUser(who: { email: string; name: string }, wantPassword: string | null) {
  let u = await findUser(who.email);
  let password = wantPassword;
  if (!u) {
    password = password ?? newPassword();
    const { data, error } = await admin.auth.admin.createUser({ email: who.email, password, email_confirm: true, user_metadata: { full_name: who.name, synthetic: true, purpose: "FDS browser fixture" } });
    if (error || !data?.user) throw new Error(`could not create ${who.email}: ${error?.message}`);
    u = data.user;
  } else if (password) {
    const { error } = await admin.auth.admin.updateUserById(u.id, { password, email_confirm: true });
    if (error) throw new Error(`could not set the password of ${who.email}: ${error.message}`);
  }
  await admin.from("profiles").update({ full_name: who.name }).eq("id", u.id);
  return { id: u.id as string, password };
}

async function remove() {
  for (const f of FW) {
    const { data } = await admin.from("frameworks").select("id, pub_status").eq("code", f.code).is("hospital_id", null);
    for (const r of data ?? []) {
      if (r.pub_status !== "draft") await admin.from("frameworks").update({ pub_status: "draft" }).eq("id", r.id);
      await admin.from("frameworks").delete().eq("id", r.id);
    }
  }
  for (const w of [AUTHOR, PUBLISHER]) {
    const u = await findUser(w.email);
    if (!u) continue;
    await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
  console.log("removed the fixture frameworks and both fixture users");
}

/** 3 domains; domain 1 has 3 competencies; competency 1 has 5 criteria across 2 sections (3 + 2). */
async function build(frameworkId: string, label: string) {
  const shape = [
    { name: `${label} domain A`, comps: ["Hand hygiene", "Vital signs", "Medication safety"] },
    { name: `${label} domain B`, comps: ["Wound care"] },
    { name: `${label} domain C`, comps: ["Patient handover"] },
  ];
  for (const [di, d] of shape.entries()) {
    const dom = await admin.from("framework_domains").insert({ framework_id: frameworkId, name: d.name, sort_order: di }).select("id").single();
    if (dom.error) throw new Error(dom.error.message);
    for (const [ci, cname] of d.comps.entries()) {
      const c = await admin.from("framework_competencies").insert({ domain_id: dom.data.id, name: `${label}: ${cname}`, description: `Fixture competency. Not clinically reviewed.`, sort_order: ci }).select("id").single();
      if (c.error) throw new Error(c.error.message);
      const rows = [
        ...[1, 2, 3].map(n => ({ name: `${cname}: performs step ${n}`, component_code: "clinical_skills" })),
        ...[1, 2].map(n => ({ name: `${cname}: explains reason ${n}`, component_code: "knowledge" })),
      ].map((r, i) => ({ competency_id: c.data.id, ...r, sort_order: i }));
      const s = await admin.from("competency_skills").insert(rows);
      if (s.error) throw new Error(s.error.message);
    }
  }
}

async function ensureFramework(f: typeof FW[number], publisher: { id: string; name: string }) {
  let { data: row } = await admin.from("frameworks").select("id, pub_status").eq("code", f.code).is("hospital_id", null).maybeSingle();
  if (!row) {
    const ins = await admin.from("frameworks").insert({ name: f.name, code: f.code, description: "Browser fixture for FRAMEWORK-DESIGN-STUDIO-01. Synthetic, staging only.",
      library: "core", hospital_id: null, scope: "master", is_active: true, pub_status: "draft", competency_layer: null }).select("id, pub_status").single();
    if (ins.error) throw new Error(`framework ${f.code}: ${ins.error.message}`);
    row = ins.data;
    await build(row.id, f.key === "draft" ? "FDS draft" : "FDS pub");
  }
  if (f.publish && row.pub_status === "draft") {
    const r = await transitionFramework(admin, row.id, "publish", { id: publisher.id, name: publisher.name });
    if (!r.ok) throw new Error(`publishing ${f.code} was refused: ${r.error} (${r.code})`);
  }
  const chk = (await admin.from("frameworks").select("pub_status").eq("id", row.id).single()).data;
  if (chk?.pub_status !== (f.publish ? "published" : "draft")) throw new Error(`${f.code} is ${chk?.pub_status}, expected ${f.publish ? "published" : "draft"}`);
  return row.id as string;
}

async function main() {
  console.log(`staging ${verdict.ok ? verdict.ref : ""}`);
  if (process.argv.includes("--remove")) return remove();
  const owner = await fixtureOwnerId(admin);
  const author = await ensureUser(AUTHOR, savedPassword());
  const publisher = await ensureUser(PUBLISHER, null);

  // Gate 1 (COMP-ARCH-PSA-001): /super-admin admits only a platform member. Same row provision-staging-hq-fixture.ts creates.
  const pm = (await admin.from("platform_membership").select("id, status").eq("user_id", author.id).maybeSingle()).data;
  if (!pm) {
    const r = await admin.from("platform_membership").insert({ user_id: author.id, status: "active", source: "admin_grant", note: "FDS browser fixture author. Staging only." });
    if (r.error) throw new Error(`platform_membership failed: ${r.error.message}`);
  } else if (pm.status !== "active") {
    const r = await admin.from("platform_membership").update({ status: "active" }).eq("id", pm.id);
    if (r.error) throw new Error(`platform_membership activate failed: ${r.error.message}`);
  }

  const existing = (await admin.from("ogs_office_appointments").select("id, status").eq("person_id", author.id).eq("role", "competency_author")).data ?? [];
  if (!existing.some((a: any) => a.status === "active")) {
    const office = (await admin.from("ogs_offices").select("id, office_type, is_active, status").like("office_type", `${HQ_OFFICE_TYPE_PREFIX}%`).limit(50)).data
      ?.find((o: any) => o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
    if (!office) throw new Error("staging has no active HQ office to appoint to");
    const a = await admin.from("ogs_office_appointments").insert({ ...appointmentAuthority(owner), office_id: office.id, person_id: author.id, person_name: AUTHOR.name, role: "competency_author", status: "active" });
    if (a.error) throw new Error(`the competency_author appointment failed: ${a.error.message}`);
  }
  const roles = ((await admin.from("ogs_office_appointments").select("role, status").eq("person_id", author.id)).data ?? []).filter((a: any) => a.status === "active").map((a: any) => a.role);
  if (roles.some((r: string) => /publish|quality_council/.test(r))) throw new Error(`the author holds a publishing position (${roles.join(", ")})`);

  const ids: Record<string, string> = {};
  for (const f of FW) ids[f.key] = await ensureFramework(f, { id: publisher.id, name: PUBLISHER.name });

  const password = author.password ?? savedPassword();
  if (!password) throw new Error("no password is known for the author; delete the user with --remove and re-run");
  writeFileSync(OUT, [
    `email: ${AUTHOR.email}`,
    `password: ${password}`,
    `login: http://localhost:3100/login`,
    `draft framework: ${BASE}/${ids.draft}`,
    `published framework: ${BASE}/${ids.published}`,
    `positions: ${roles.join(", ")}`,
    "",
  ].join("\n"));
  console.log(`fixture ready: author ${AUTHOR.email} (${roles.join(", ")}); draft ${ids.draft}; published ${ids.published}; details in the scratchpad file`);
}
// Run as a script; the FDS-02 acceptance harness imports the helpers above without running this.
if (/fds-browser-fixture.ts$/.test(process.argv[1] ?? "")) main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
