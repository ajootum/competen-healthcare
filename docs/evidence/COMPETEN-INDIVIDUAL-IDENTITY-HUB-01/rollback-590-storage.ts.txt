/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ROLLBACK 590, STORAGE STEP -- STAGING ONLY. Empties and deletes the private bucket individual-photos through the
 * Storage API, which is the only way Supabase allows (SQL deletes on storage tables are refused). Run it after
 * ROLLBACK-590.sql when rehearsing a full rollback. Re-applying 590 recreates the bucket.
 *
 * It refuses any project but staging: it reads STAGING_SUPABASE_URL and STAGING_SERVICE_ROLE_KEY only, and checks
 * the project ref against the production ref before doing anything.
 *
 *   npx tsx rollback-590-storage.ts            (from the repository root, with .env.local present)
 *   npx tsx rollback-590-storage.ts --check    (read-only: says whether the bucket exists and how many objects it has)
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const PRODUCTION_REF = "rnnqhlrcgvsauigxwszl", STAGING_REF = "ezhvpgtcqcdsgylrxgdb";
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? "";
if (!url || !key || ref !== STAGING_REF || ref === PRODUCTION_REF) { console.error(`REFUSING: this runs on staging (${STAGING_REF}) only. Got "${ref || "no URL"}".`); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BUCKET = "individual-photos";

async function count(): Promise<number | null> {
  let n = 0;
  const walk = async (prefix: string): Promise<boolean> => {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) return false;
    for (const e of data ?? []) {
      if (e.id) n++;
      else if (!(await walk(prefix ? `${prefix}/${e.name}` : e.name))) return false;
    }
    return true;
  };
  return (await walk("")) ? n : null;
}

async function main() {
  const { data: bucket } = await admin.storage.getBucket(BUCKET);
  if (!bucket) { console.log(`${BUCKET}: not present on ${ref}. Nothing to do.`); return; }
  console.log(`${BUCKET} on ${ref}: public=${bucket.public}, objects=${await count() ?? "unreadable"}`);
  if (process.argv.includes("--check")) return;
  const emptied = await admin.storage.emptyBucket(BUCKET);
  if (emptied.error) { console.error(`emptyBucket failed: ${emptied.error.message}`); process.exit(1); }
  const deleted = await admin.storage.deleteBucket(BUCKET);
  if (deleted.error) { console.error(`deleteBucket failed: ${deleted.error.message}`); process.exit(1); }
  const { data: after } = await admin.storage.getBucket(BUCKET);
  console.log(after ? `FAILED: ${BUCKET} is still present.` : `${BUCKET} emptied and deleted on ${ref}.`);
  if (after) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
