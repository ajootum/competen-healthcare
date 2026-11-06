// Read only. What the fixture learner has on staging for the walk. Prints ids and titles, never credentials.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const req = createRequire(join(process.cwd(), "package.json"));
req("@next/env").loadEnvConfig("C:/Users/elish/Documents/Competen/competen-sale-r1");
const url = process.env.STAGING_SUPABASE_URL!;
if (!url.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("not staging");
const admin = req("@supabase/supabase-js").createClient(url, process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const fixture = readFileSync(process.env.WALK_FIXTURE!, "utf8");
const email = fixture.split(/\r?\n/).find(l => l.startsWith("email="))?.slice(6).trim();
const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
const userId = users.find((u: { email?: string }) => u.email === email)?.id;
const { data: m } = await admin.from("individual_scholar_material").select("id, title, file_name, chunk_count").eq("user_id", userId).eq("file_name", "Growth and Development.pptx").maybeSingle();
console.log("material", m);
const { data: chunks } = await admin.from("individual_scholar_chunk").select("id, ordinal, page_from, content").eq("user_id", userId).eq("material_id", m.id).ilike("content", "%cephalocaudal%").limit(5);
console.log("cephalocaudal chunks", (chunks ?? []).map((c: { id: string; ordinal: number; page_from: number; content: string }) => ({ id: c.id, ordinal: c.ordinal, page: c.page_from, start: c.content.slice(0, 80) })));
const { data: sessions } = await admin.from("individual_scholar_learning_session").select("id, title, scope_kind, current_step, connected").eq("user_id", userId).order("last_active_at", { ascending: false }).limit(10);
console.log("sessions", sessions);
for (const s of sessions ?? []) {
  const { data: steps } = await admin.from("individual_scholar_learning_step").select("step, chunk_ids").eq("user_id", userId).eq("session_id", s.id).order("step");
  const hit = (steps ?? []).filter((x: { chunk_ids?: string[] }) => (chunks ?? []).some((c: { id: string }) => x.chunk_ids?.includes(c.id))).map((x: { step: number }) => x.step);
  console.log(s.id, "steps", steps?.length ?? 0, "cephalocaudal in step", hit);
}
const { count } = await admin.from("individual_scholar_note").select("id", { count: "exact", head: true }).eq("user_id", userId);
console.log("notes on this learner", count);
