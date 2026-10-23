/**
 * ACCOUNT PROFILE HARNESS -- "My profile" (owner GO 2026-10-23, PR D), checked from source and migration 380.
 *
 *   npx --yes tsx scripts/account-profile-harness.ts
 *
 * No database and no network: it reads src/** and the migration, so it runs in CI. What it pins:
 *
 *   A  a self-update can never change access: the route writes only the allowlisted personal fields,
 *      through the caller's OWN session (so the column grants and the RLS WITH CHECK
 *      profile_authority_unchanged apply), keyed on the caller's id
 *   E  email is never written to profiles by any account surface; it changes only through
 *      supabase.auth.updateUser({ email }), Supabase's verified flow
 *   N  given and family names are never derived from full_name, anywhere in the account surfaces or the
 *      PW-011 profile page
 *   M  each product shell mounts the shared card inside a page that runs that shell's own guard first
 *   S  migration 380 (when present): additive columns, no policy, no function, no table-level grant, and a
 *      column-level grant on the two name columns only
 *   C  the card states that a profile is not a credential, and the account surfaces read no credential store
 *
 * ⚠ EVERY CHECK HAS A PLANTED-FAILURE CONTROL (section P), run on a copy of the source with the violation
 * planted, which must FAIL. A check that cannot fail is worth nothing (CLAUDE.md, Testing).
 */
import { readFileSync, existsSync } from "node:fs";
import { PROFILE_FIELDS, NAME_FIELDS, parseProfilePatch } from "../src/lib/account/own-profile";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
// Line endings normalised (a Windows checkout has CRLF); comments stripped, because these files explain
// at length the very calls they must not make.
const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const ROUTE = "src/app/api/account/profile/route.ts";
const LIB = "src/lib/account/own-profile.ts";
const CARD = "src/components/account/OwnProfileCard.tsx";
const SHELLS = {
  estate: "src/app/dashboard/profile/page.tsx",
  practice: "src/app/practice/(shell)/settings/page.tsx",
  individual: "src/app/individual/(app)/[experience]/settings/page.tsx",
} as const;
const ESTATE_LAYOUT = "src/app/dashboard/layout.tsx";
const MIG = "supabase/migrations/380-profiles-given-family-name.sql";
type Src = Map<string, string>;
const REAL: Src = new Map([ROUTE, LIB, CARD, ESTATE_LAYOUT, ...Object.values(SHELLS)].map(f => [f, strip(read(f))]));
const MIG_REAL = existsSync(MIG) ? read(MIG).replace(/--.*$/gm, "").toLowerCase() : "";

// ── A. the write ────────────────────────────────────────────────────────────────────────────────────
/** The PATCH handler body. */
const patchBody = (src: Src) => { const s = src.get(ROUTE) ?? ""; const i = s.indexOf("export async function PATCH"); return i < 0 ? "" : s.slice(i); };
/** The profiles update in PATCH uses the SESSION client, filters on the caller's id, and writes the parsed patch only. */
const writeThroughSession = (src: Src) => {
  const b = patchBody(src);
  return /const \{ supabase, user \} = await sessionUser\(\);/.test(b)
    && /await supabase\.from\("profiles"\)\.update\(update\)\.eq\("id", user\.id\)/.test(b)
    && !/admin\.from\("profiles"\)\.update/.test(b) && !/createAdminClient\(\)\.from\("profiles"\)/.test(b)
    && /const update = parsed\.patch;/.test(b);
};
/** The allowlist is personal fields only. */
const AUTHORITY = ["role", "roles", "org_role", "org_roles", "platform_role", "platform_roles", "hospital_id", "organisation_id", "tenant_id", "managed_country", "is_senior_assessor", "account_status", "email", "id"];
const allowlistClean = (fields: readonly string[]) => fields.every(f => !AUTHORITY.includes(f));

// ── E. email ────────────────────────────────────────────────────────────────────────────────────────
const emailWrites = (src: Src) => [...src].filter(([f]) => f !== ESTATE_LAYOUT && !Object.values(SHELLS).includes(f as never))
  .filter(([, s]) => /from\("profiles"\)\s*\.(update|upsert|insert)\([^)]*email/.test(s) || /\bemail\s*:\s*[^,}]+[,}]/.test((s.match(/\.update\(\{[\s\S]*?\}\)/g) ?? []).join(" "))).map(([f]) => f);
const emailViaAuth = (src: Src) => /\.auth\.updateUser\(\{ email: /.test(src.get(CARD) ?? "");

// ── N. never infer names ────────────────────────────────────────────────────────────────────────────
const inferredNames = (src: Src) => [...src].filter(([, s]) => /full_?[Nn]ame\)?\.split\(\s*["'` ]+\s*\)\s*\[\s*0\s*\]/.test(s)).map(([f]) => f);

// ── M. each shell mounts the card behind its own guard ─────────────────────────────────────────────
const GUARD: Record<keyof typeof SHELLS, RegExp> = {
  estate: /if \(!user\) redirect\("\/login"\);/,
  practice: /if \(shell\.state !== "READY"\) redirect\("\/practice"\);/,
  individual: /const page = await experiencePage\(.*\);\s*\n\s*if \(!page\) return null;/,
};
function unguardedMounts(src: Src): string[] {
  const bad: string[] = [];
  for (const [k, f] of Object.entries(SHELLS) as [keyof typeof SHELLS, string][]) {
    const s = src.get(f) ?? "";
    const g = s.search(GUARD[k]), m = s.indexOf("<OwnProfileCard");
    if (g < 0 || m < 0 || m < g) bad.push(k);
  }
  // The estate page also sits behind the /dashboard layout's estate gate.
  if (!/admitToEstate\(/.test(src.get(ESTATE_LAYOUT) ?? "")) bad.push("estate-layout");
  return bad;
}

// ── S. migration 380 ───────────────────────────────────────────────────────────────────────────────
const migSafe = (m: string) =>
  /alter table profiles add column if not exists given_name text;/.test(m)
  && /alter table profiles add column if not exists family_name text;/.test(m)
  && !/\bpolicy\b/.test(m) && !/create (or replace )?function|plpgsql|\$\$/.test(m)
  && !/default\s/.test(m) && !/\bupdate\s+profiles\s+set\b/.test(m)
  && (m.match(/\bgrant\b[^;]*;/g) ?? []).every(g => /^grant update \(given_name, family_name\) on table profiles to authenticated;$/.test(g.trim()))
  && !/\bdrop column\b|\balter column\b|\bset not null\b/.test(m);

// ── C. not a credential ────────────────────────────────────────────────────────────────────────────
const CRED_TABLES = /professional_credentials|individual_professional_|competency_decisions|clinical_authorizations/;
const credentialReads = (src: Src) => [ROUTE, LIB, CARD].filter(f => CRED_TABLES.test(src.get(f) ?? ""));

function main() {
  console.log("ACCOUNT PROFILE HARNESS (owner GO 2026-10-23, PR D -- My profile)\n");

  ok("A1. the self-update writes through the caller's own session, on their own id, with the parsed patch only", writeThroughSession(REAL));
  ok("A2. the allowlist holds personal fields only -- no authority column, no email",
    allowlistClean(PROFILE_FIELDS) && allowlistClean(NAME_FIELDS));
  ok("A3. a body full of authority fields reaches the update as nothing",
    JSON.stringify(parseProfilePatch({ role: "super_admin", roles: ["super_admin"], platform_role: "owner", email: "x@example.test", account_status: "active" })) === JSON.stringify({ ok: false, error: "Nothing to update." }));
  ok("E1. no account surface writes email to profiles", emailWrites(REAL).length === 0, emailWrites(REAL).join(", "));
  ok("E2. email changes only through supabase.auth.updateUser({ email }), the verified flow", emailViaAuth(REAL));
  ok("N1. no account surface or the profile page derives a name from full_name", inferredNames(REAL).length === 0, inferredNames(REAL).join(", "));
  ok("M1. each shell mounts the card after its own guard (estate also behind the /dashboard estate gate)",
    unguardedMounts(REAL).length === 0, unguardedMounts(REAL).join(", "));
  if (!MIG_REAL) console.log(`  NOTE  ${MIG} is not in this checkout -- S1 and P8 NOT RUN`);
  if (MIG_REAL) ok("S1. 380: two additive nullable columns, no default or backfill, no policy, no function, only a column grant on the two names", migSafe(MIG_REAL));
  ok("C1. the account surfaces read no credential or registration store", credentialReads(REAL).length === 0, credentialReads(REAL).join(", "));
  ok("C2. the card says a profile is not a credential", /This is your personal profile, not a credential\./.test(REAL.get(CARD) ?? ""));

  // ── P. planted-failure controls ──
  const plant = (file: string, from: string | RegExp, to: string): Src => {
    const copy = new Map(REAL); const before = copy.get(file) ?? ""; const after = before.replace(from, to);
    if (after === before) throw new Error(`plant did not apply in ${file}: ${String(from)}`);
    copy.set(file, after); return copy;
  };
  ok("P1. ⚠ A1 goes red when the write goes back to the service role",
    !writeThroughSession(plant(ROUTE, 'await supabase.from("profiles").update(update).eq("id", user.id)', 'await createAdminClient().from("profiles").update(update).eq("id", user.id)')));
  ok("P2. ⚠ A1 goes red when the update loses its own-id filter",
    !writeThroughSession(plant(ROUTE, '.update(update).eq("id", user.id)', '.update(update).eq("id", body.id)')));
  ok("P3. ⚠ A2 goes red when an authority column joins the allowlist", !allowlistClean([...PROFILE_FIELDS, "role"]));
  ok("P4. ⚠ E1 goes red when an account surface writes email to profiles",
    emailWrites(plant(ROUTE, 'const update = parsed.patch;', 'const update = { ...parsed.patch, email: user.email };\n  await supabase.from("profiles").update({ email: user.email }).eq("id", user.id);')).length > 0);
  ok("P5. ⚠ E2 goes red when the card stops using the verified flow",
    !emailViaAuth(plant(CARD, ".auth.updateUser({ email: ", ".from(\"profiles\").update({ email: ")));
  ok("P6. ⚠ N1 goes red when a page splits full_name into a given name",
    inferredNames(plant(SHELLS.estate, "<OwnProfileCard", '{p.fullName.split(" ")[0]}<OwnProfileCard')).length > 0);
  ok("P7. ⚠ M1 goes red when a shell mounts the card before its guard",
    unguardedMounts(plant(SHELLS.practice, 'if (shell.state !== "READY") redirect("/practice");', "")).length > 0);
  if (MIG_REAL) ok("P8. ⚠ S1 goes red on a policy change, a default, or a wider grant",
    !migSafe(`${MIG_REAL}\ncreate policy x on profiles for update using (true);`)
    && !migSafe(MIG_REAL.replace("add column if not exists given_name text;", "add column if not exists given_name text default '';"))
    && !migSafe(`${MIG_REAL}\ngrant update on table profiles to authenticated;`));
  ok("P9. ⚠ C1 goes red when the card reads a credential store",
    credentialReads(plant(LIB, 'export const PROFILE_FIELDS', 'const _c = (a: any) => a.from("professional_credentials");\nexport const PROFILE_FIELDS')).length > 0);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
