/**
 * EMAIL SYNC HARNESS -- migration 381 (owner GO 2026-10-23, item 4), checked from the migration text.
 *
 *   npx --yes tsx scripts/email-sync-harness.ts
 *
 * No database and no network, so it runs in CI. What it pins, each with a planted-failure control:
 *   T  the trigger fires only AFTER UPDATE OF email ON auth.users, once per row
 *   G  the function copies only a CHANGED, CONFIRMED, non-null email, only into that person's profile row,
 *      and only when it differs
 *   A  every copy writes one audit_log row (actor auth, old and new value)
 *   S  SECURITY DEFINER with a fixed search_path, EXECUTE revoked from public, anon and authenticated, the
 *      APPLY WHOLE banner in the first 15 lines, and a failure that never blocks the auth update
 *   B  no backfill and no other write: the only data statement is the one inside the function
 *   R  the rollback drops exactly the trigger and the function
 */
import { readFileSync, existsSync } from "node:fs";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
const MIG = "supabase/migrations/381-sync-confirmed-auth-email-to-profile.sql";
const RB = "docs/evidence/ACCOUNT-EMAIL-SYNC/ROLLBACK-381.sql";
const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const RAW = existsSync(MIG) ? read(MIG) : "";
const code = (s: string) => s.replace(/--.*$/gm, "").toLowerCase();
const REAL = code(RAW);
const RB_REAL = existsSync(RB) ? code(read(RB)) : "";

const trigger = (m: string) =>
  /create trigger on_auth_user_email_confirmed\s+after update of email on auth\.users\s+for each row\s+execute function public\.sync_confirmed_auth_email_to_profile\(\);/.test(m)
  && (m.match(/create trigger/g) ?? []).length === 1;
const guarded = (m: string) =>
  /if new\.email is not distinct from old\.email then\s+return new;/.test(m)
  && /if new\.email is null or new\.email_confirmed_at is null then\s+return new;/.test(m)
  && /update public\.profiles\s+set email = new\.email\s+where id = new\.id\s+and email is distinct from new\.email;/.test(m)
  && m.indexOf("email_confirmed_at is null") < m.indexOf("update public.profiles");
const audited = (m: string) =>
  /if found then\s+insert into public\.audit_log[^;]*'auth', 'sync_profile_email', 'profile', new\.id[^;]*jsonb_build_object\('email', old\.email\), jsonb_build_object\('email', new\.email\)\);/.test(m);
const secured = (m: string, raw: string) =>
  /security definer\s+set search_path = public, pg_catalog/.test(m)
  && /revoke all on function public\.sync_confirmed_auth_email_to_profile\(\) from public;/.test(m)
  && /revoke all on function public\.sync_confirmed_auth_email_to_profile\(\) from anon, authenticated;/.test(m)
  && /exception when others then\s+raise warning/.test(m)
  && raw.split("\n").slice(0, 15).some(l => /APPLY THIS FILE WHOLE/.test(l));
/** Data statements outside the function body. */
const outsideWrites = (m: string) => {
  const body = m.slice(m.indexOf("as $$"), m.lastIndexOf("$$;"));
  // String literals out: the function's COMMENT describes the update it makes.
  const rest = m.replace(body, "").replace(/'(?:[^']|'')*'/g, "''");
  return /\b(update|insert into|delete from)\b/.test(rest.replace(/revoke all on function[^;]*;/g, "").replace(/after update of email/g, ""));
};
const rollbackExact = (r: string) =>
  /drop trigger if exists on_auth_user_email_confirmed on auth\.users;/.test(r)
  && /drop function if exists public\.sync_confirmed_auth_email_to_profile\(\);/.test(r)
  && !/\b(update|delete|alter table|drop table|drop column)\b/.test(r);

function main() {
  console.log("EMAIL SYNC HARNESS (migration 381)\n");
  if (!RAW) { console.log(`  NOTE  ${MIG} is not in this checkout -- nothing to check`); return; }
  ok("T1. fires only AFTER UPDATE OF email ON auth.users, for each row, one trigger", trigger(REAL));
  ok("G1. copies only a changed, confirmed, non-null email into that person's own row, and only if different", guarded(REAL));
  ok("A1. every copy writes one audit_log row: actor auth, old and new", audited(REAL));
  ok("S1. SECURITY DEFINER with a fixed search_path, EXECUTE revoked, APPLY WHOLE banner, never blocks auth", secured(REAL, RAW));
  ok("B1. no backfill and no write outside the function", !outsideWrites(REAL));
  if (RB_REAL) ok("R1. the rollback drops exactly the trigger and the function, and touches no data", rollbackExact(RB_REAL));

  ok("P1. ⚠ T1 goes red on a trigger over every update", !trigger(REAL.replace("after update of email on auth.users", "after update on auth.users")));
  ok("P2. ⚠ G1 goes red when the confirmed check is dropped", !guarded(REAL.replace("if new.email is null or new.email_confirmed_at is null then", "if new.email is null then")));
  ok("P3. ⚠ G1 goes red when the update loses its own-row filter", !guarded(REAL.replace("where id = new.id\n", "where true\n")));
  ok("P4. ⚠ A1 goes red when the audit row is removed", !audited(REAL.replace(/if found then\s+insert into public\.audit_log[\s\S]*?\);/, "if found then null;")));
  ok("P5. ⚠ S1 goes red without a fixed search_path, or with the banner gone",
    !secured(REAL.replace("set search_path = public, pg_catalog", ""), RAW) && !secured(REAL, RAW.replace("APPLY THIS FILE WHOLE", "apply")));
  ok("P6. ⚠ B1 goes red on a backfill", outsideWrites(`${REAL}\nupdate public.profiles p set email = u.email from auth.users u where u.id = p.id;`));
  if (RB_REAL) ok("P7. ⚠ R1 goes red when the rollback touches data", !rollbackExact(`${RB_REAL}\nupdate public.profiles set email = null;`));

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}
main();
