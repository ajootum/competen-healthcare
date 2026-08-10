import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data: ws } = await admin.from("practice_workspace").select("id, name");
  for (const w of (ws ?? []) as any[]) {
    const { data: m, error } = await admin.from("practice_membership").select("user_id").eq("workspace_id", w.id).eq("status", "active");
    if (error) { console.log(`  ${w.name}: read failed - ${error.message}`); continue; }
    const people = new Set((m ?? []).map((x: any) => x.user_id));
    console.log(`  ${String(w.name).padEnd(14)} ${people.size} distinct person(s), ${(m ?? []).length} membership rows` + (people.size < 2 ? "   <-- CANNOT EVER APPROVE ITS OWN GUIDANCE" : ""));
  }
})();
