// SCHOLAR-CE07C staging proof of the abandoned-upload clean-up (sweepAllUploads, the hourly cron; sweepPersonUploads,
// on the learner's next upload). Plants one abandoned upload (record issued 25 h ago + its object), runs both, checks.
// Then removes the walk's test materials so the fixture is left as it was (3 materials).
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { sweepAllUploads } from "@/lib/individual/scholar-upload-sweep";
import { sweepPersonUploads } from "@/lib/individual/scholar/store";
import { deleteMaterial } from "@/lib/individual/scholar/store";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!env.STAGING_SUPABASE_URL.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("not staging");
const admin = createClient(env.STAGING_SUPABASE_URL, env.STAGING_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const fx = Object.fromEntries(fs.readFileSync("C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/guided-fixture.txt", "utf8").split(/\r?\n/).filter(Boolean).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { data: u } = await admin.from("profiles").select("id").eq("email", fx.email).maybeSingle();
const USER = u!.id as string;
const B = "individual-scholar-materials";
const now = Date.now();
const id = crypto.randomUUID();
const path = `${USER}/${id}.txt`;
await admin.from("individual_scholar_upload").insert({ id, user_id: USER, mime_type: "text/plain", byte_size: 12, sha256: "c".repeat(64), state: "issued", issued_at: new Date(now - 25 * 3600_000).toISOString() });
await admin.storage.from(B).upload(path, new Blob(["abandoned ok"], { type: "text/plain" }), { contentType: "text/plain" });
const before = await admin.storage.from(B).download(path);
const all = await sweepAllUploads(admin, now);
const after = await admin.storage.from(B).download(path);
const { data: rec } = await admin.from("individual_scholar_upload").select("state, settled_at").eq("id", id).maybeSingle();
console.log(`${before.data && !after.data && rec?.state === "abandoned" ? "PASS" : "FAIL"} hourly: planted abandoned upload -> object ${after.data ? "STILL THERE" : "removed"}, record ${rec?.state}; run summary ${JSON.stringify(all)}`);
const { data: mats } = await admin.from("individual_scholar_material").select("id, storage_path, title, created_at").eq("user_id", USER);
const removed = await sweepPersonUploads(admin, USER, now);
let intact = 0;
for (const m of mats ?? []) { const d = await admin.storage.from(B).download(m.storage_path); if (d.data) intact += 1; }
console.log(`${intact === (mats ?? []).length ? "PASS" : "FAIL"} per-person: removed ${removed} old orphan object(s); all ${intact}/${(mats ?? []).length} kept materials' originals still present`);
// leave the fixture as found: remove the walk's materials (titles deck-N)
let gone = 0;
for (const m of (mats ?? []).filter(m => /^deck-\d+$/.test(m.title))) { const r = await deleteMaterial(admin, USER, m.id); if (r.ok) gone += 1; }
await admin.from("individual_scholar_upload").delete().eq("user_id", USER);
const { count } = await admin.from("individual_scholar_material").select("id", { count: "exact", head: true }).eq("user_id", USER);
console.log(`tidy: removed ${gone} walk material(s) and the fixture's upload records; fixture now has ${count} material(s)`);
