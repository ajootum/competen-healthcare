import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden } from "@/lib/api-auth";
import { runTaskAutomation } from "@/lib/operations/task-automation";

// Manual run of the task-automation engine (SSW-TSK-001) for the caller's hospital
// — fires recurring & event-triggered tasks from active templates now, instead of
// waiting for the hourly cron. Supervisor tier, tenant-scoped, audit-logged;
// 409 migration hint until 070/071 run.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();

  const r = await runTaskAutomation(c.admin, isSuper(c) ? null : c.hospitalId ?? null);
  if (!r.ok) {
    if (!(r as any).provisioned) return NextResponse.json({ error: "Run migrations 070 & 071 to enable task automation" }, { status: 409 });
    return NextResponse.json({ error: r.error }, { status: 500 });
  }

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "run_task_automation", entity_type: "task_automation", hospital_id: c.hospitalId ?? null, new_value: { generated: r.generated } });
  return NextResponse.json({ ok: true, generated: r.generated, details: r.details });
}
