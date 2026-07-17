// Creates (or deletes) a TEST super-admin account for demo/QA sign-ins.
// This runs against the LIVE database — delete the account when finished:
//   node scripts/create-test-admin.mjs --confirm            # create
//   node scripts/create-test-admin.mjs --confirm --delete   # remove it again
// The email uses the reserved .test TLD so no real inbox can ever receive
// (or hijack) its mail; password resets for it go nowhere by design.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const EMAIL = "testadmin@competen.test";
const NAME = "Test Super Admin";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

if (!process.argv.includes("--confirm")) {
  console.log("Dry run. This script writes to the LIVE database.");
  console.log(`Would ${process.argv.includes("--delete") ? "DELETE" : "create"} auth user + profile: ${EMAIL}`);
  console.log("Re-run with --confirm to proceed.");
  process.exit(0);
}

// Find any existing account with this email
const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const existing = (page?.users ?? []).find(u => u.email === EMAIL);

if (process.argv.includes("--delete")) {
  if (!existing) { console.log("Nothing to delete —", EMAIL, "does not exist."); process.exit(0); }
  await admin.from("profiles").delete().eq("id", existing.id);
  const { error } = await admin.auth.admin.deleteUser(existing.id);
  if (error) { console.error("Delete failed:", error.message); process.exit(1); }
  console.log("Deleted test admin", EMAIL);
  process.exit(0);
}

if (existing) {
  console.log(EMAIL, "already exists (id " + existing.id + ").");
  console.log("Use --delete first if you want a fresh one, or reset its password in the Users page.");
  process.exit(0);
}

const password = "Test-" + randomBytes(9).toString("base64url");
const { data: created, error } = await admin.auth.admin.createUser({
  email: EMAIL,
  password,
  email_confirm: true,
  user_metadata: { full_name: NAME },
});
if (error) { console.error("Auth create failed:", error.message); process.exit(1); }

const { error: perr } = await admin.from("profiles").upsert({
  id: created.user.id,
  email: EMAIL,
  full_name: NAME,
  role: "super_admin",
  roles: ["super_admin"],
});
if (perr) {
  await admin.auth.admin.deleteUser(created.user.id);
  console.error("Profile upsert failed (auth user rolled back):", perr.message);
  process.exit(1);
}

console.log("Created test super admin:");
console.log("  Email:    " + EMAIL);
console.log("  Password: " + password);
console.log("This is a live super-admin login — delete it after testing with --confirm --delete.");
