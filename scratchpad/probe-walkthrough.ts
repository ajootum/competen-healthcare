import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { offlineCacheGate } from "../src/lib/practice/offline-gate";
import { offlineDayPayload } from "../src/lib/practice/offline-day";
import { offlineGuidancePayload } from "../src/lib/practice/offline-guidance-source";
import type { WorkspaceContext } from "../src/lib/practice/access";
loadEnvConfig(process.cwd());
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data: mem } = await admin.from("practice_membership").select("id, workspace_id, user_id").eq("status", "active");
  const { data: ws } = await admin.from("practice_workspace").select("id, name");
  const trial = (ws ?? []).find((w: any) => w.name === "Trial") as any;
  const mine = (mem ?? []).filter((m: any) => m.workspace_id === trial.id) as any[];
  const userId = mine[0].user_id;
  const { data: caps } = await admin.from("practice_role_assignment")
    .select("capability_code").in("membership_id", mine.map(m => m.id)).is("effective_to", null);
  const capabilities = [...new Set((caps ?? []).map((c: any) => c.capability_code))];

  const ctx: WorkspaceContext = {
    userId, workspaceId: trial.id, workspaceName: trial.name, workspaceType: "individual_practice",
    workspaceStatus: "active", roleCodes: ["practice_owner"], capabilities, entitled: true,
    entitlementStatus: "trial", onboardingComplete: true, onboardingStep: null,
  } as WorkspaceContext;

  console.log(`\n=== GATE, for ${trial.name} ===`);
  const gate = await offlineCacheGate(admin, ctx, userId);
  console.log(`  state=${gate.state}  allowed=${gate.allowed}  decidedBy=${gate.decidedBy}`);
  console.log(`  ${gate.reason}`);

  console.log("\n=== WHAT WOULD BE CACHED, TODAY ===");
  const day = await offlineDayPayload(admin, ctx);
  if (!day.ok) console.log("  DAY: refused -", day.reason);
  else console.log(`  DAY: date=${day.day.date} tz=${day.day.timezone} sessions=${day.day.sessions.length} patients=${day.day.patients.length} patientsUnavailable=${day.day.patientsUnavailable} expires=${day.day.expiresAt}`);

  const g = await offlineGuidancePayload(admin, ctx, { timezone: "Africa/Kampala" });
  if (!g.ok) console.log("  GUIDANCE: refused -", g.reason);
  else console.log(`  GUIDANCE: documents=${g.library.documents.length} dropped=${g.library.dropped?.count ?? 0} expires=${g.library.expiresAt}`);
})();
