/**
 * Issue a practitioner identity to every practice owner who has none -- PIS-000 s15.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ IT BACKFILLS A ROW. IT NEVER BACKFILLS A PUBLIC NAME.
 *
 * issueIdentity() writes a permanent practitioner number, the owner's own name, discovery `hidden`, and
 * a NULL handle. It does not, and must not, choose an @address: a handle appears in a URL given to
 * patients and cannot afterwards be released to anybody else, so deriving one from a real person's name
 * in a batch job would publish a name nobody agreed to and permanently consume it. Every practitioner
 * claims their own at /practice/setup/identity, having seen the URL first.
 *
 * ⚠ WHY A SCRIPT AND NOT A MIGRATION. Issuing a number goes through the sequence in migration 219 and
 * the format table in 220, and it locks the format on first use. That is engine behaviour, not schema,
 * and expressing it as SQL would fork the rule -- the shape of a practitioner number would then be
 * decided in two places.
 *
 * ⚠ IDEMPOTENT. issueIdentity is keyed on a unique user_id and returns the existing row rather than a
 * second one, so re-running this changes nothing and issues no new numbers.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 *   npx --yes tsx scripts/practice-identity-backfill.ts            # report only
 *   npx --yes tsx scripts/practice-identity-backfill.ts --apply    # issue
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { issueIdentity, getIdentity, resolveDisplayName } from "../src/lib/practice/identity-service";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const apply = process.argv.includes("--apply");

async function main() {
  console.log(`\nPractitioner identity backfill -- ${apply ? "APPLYING" : "DRY RUN"}\n`);

  const { data: workspaces, error } = await admin.from("practice_workspace")
    .select("id, name, type, status, owner_person_id").order("created_at");
  // ⚠ A FAILED READ IS NOT AN EMPTY WORKSPACE LIST. Reporting "0 to do" here would look like success.
  if (error || workspaces == null) {
    console.error(`  the workspace list could not be read, so nothing was done: ${error?.message ?? "no rows and no error"}`);
    process.exit(1);
  }

  let issued = 0, already = 0, skipped = 0, failed = 0;

  for (const ws of workspaces as any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const existing = await getIdentity(admin, ws.owner_person_id);
    if (existing) {
      already++;
      console.log(`  have  ${ws.name} -- ${existing.practitioner_number}, handle ${existing.handle ?? "unclaimed"}`);
      continue;
    }

    const displayName = await resolveDisplayName(admin, ws.owner_person_id, ws.id);
    if (!displayName) {
      skipped++;
      console.log(`  skip  ${ws.name} -- no name on the owner's profile and none this script may infer`);
      continue;
    }

    if (!apply) {
      issued++;
      console.log(`  WOULD ${ws.name} -- issue to "${displayName}", no handle`);
      continue;
    }

    const result = await issueIdentity(admin, {
      userId: ws.owner_person_id, displayName, workspaceId: ws.id,
      correlationId: "identity-backfill",
    });
    if (!result.ok) {
      failed++;
      console.log(`  FAIL  ${ws.name} -- ${result.code}: ${result.message}`);
      continue;
    }
    issued++;
    console.log(`  done  ${ws.name} -- ${result.data.practitionerNumber}, handle ${result.data.handle ?? "unclaimed"}`);
  }

  console.log(`\n  ${workspaces.length} workspaces · ${issued} ${apply ? "issued" : "to issue"} · ${already} already had one · ${skipped} skipped · ${failed} failed`);
  console.log("  No handle was assigned to anybody. Each practitioner claims their own address.\n");
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
