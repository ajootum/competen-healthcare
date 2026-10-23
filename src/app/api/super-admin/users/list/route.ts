import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";

// HQ-USERS-A: the same capability as the /super-admin/users page it serves, through the HQ gate
// (owners and appointees holding hq.platform.users.view), not the legacy profiles.role column.
export async function GET() {
  const ctx = await hqApiGate(["hq.platform.users.view"]);
  if (isHqRefusal(ctx)) return ctx;
  const admin = ctx.admin;

  // Try selecting sub_role — ignore error if column doesn't exist yet
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, full_name, email, role, roles, hospital_id, specialization, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // `profiles` has no sub_role column on this schema. The second query fetched it "separately to be safe",
  // errored, and the resulting map was always empty — so every sub_role was null anyway, at the cost of a
  // full extra scan of profiles on every request. The field is kept in the response so consumers' shape is
  // unchanged, but it is now honestly and cheaply null. Found by scripts/schema-drift-audit.ts.
  const merged = (profiles ?? []).map(p => ({ ...p, sub_role: null as string | null }));

  return NextResponse.json({ profiles: merged });
}
