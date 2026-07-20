import { notify } from "@/lib/notify";

// ── Workforce Assignment Engine (CDN-001, Phase 1) ───────────────────────────
// Orchestrates provisioning WHEN an employee is assigned to a Position; the
// existing downstream engines own HOW each resource is created. The pipeline is
// validated, idempotent, conflict-deduped and fully audited (spec Chapter 6/10).
//
// `admin` is the service-role Supabase client. It is intentionally typed loosely
// (any) because the new workforce_* tables are not in the generated DB types and
// dynamic table access otherwise blows up tsc type inference.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = any;

const WORKSPACE_KEYS = ["nurse", "assessor", "educator", "hospital_admin", "super_admin"];

export type ProvisionInput = {
  employeeId: string;
  positionId: string;
  assignmentType?: "permanent" | "temporary" | "secondary" | "acting";
  isPrimary?: boolean;
  effectiveFrom?: string;      // YYYY-MM-DD
  effectiveTo?: string | null; // YYYY-MM-DD (required for temporary/acting)
  actorId: string;
  actorName?: string | null;
};

export type StepResult = { step: string; ok: boolean; detail?: string };
export type ProvisionResult = {
  ok: boolean;
  assignmentId?: string;
  status: "complete" | "partial" | "failed";
  steps: StepResult[];
  error?: string;
};

async function audit(admin: Admin, row: Record<string, unknown>) {
  try { await admin.from("audit_log").insert(row); } catch { /* audit best-effort */ }
}

// Recompute a profile's portal roles from the workspace registry. WAE-managed
// roles come from the registry (active = granted); any role WAE never touched
// (e.g. a manually granted super_admin) is preserved. This is how removing a
// position drops only the roles no longer granted by any active assignment.
async function recomputeRoles(admin: Admin, employeeId: string): Promise<string[]> {
  const { data: reg } = await admin.from("workspace_registry").select("workspace_type, status").eq("employee_id", employeeId);
  const managed = new Set((reg ?? []).map((r: any) => r.workspace_type));
  const active = (reg ?? []).filter((r: any) => r.status === "active").map((r: any) => r.workspace_type);
  const { data: p } = await admin.from("profiles").select("roles, role").eq("id", employeeId).single();
  const current: string[] = (p?.roles?.length ? p.roles : [p?.role]).filter(Boolean);
  const manual = current.filter(r => !managed.has(r));         // roles WAE never provisioned
  const next = [...new Set([...manual, ...active])];
  const primary = active[0] ?? (next.includes("nurse") ? "nurse" : next[0] ?? "nurse");
  await admin.from("profiles").update({ roles: next, role: primary }).eq("id", employeeId);
  return next;
}

// Validate the organisational context before any provisioning (spec Chapter 6 §1).
async function validate(admin: Admin, input: ProvisionInput) {
  const { data: emp } = await admin.from("profiles").select("id, full_name, roles, role, hospital_id, organisation_id").eq("id", input.employeeId).maybeSingle();
  if (!emp) return { error: "Employee not found" };

  const { data: pos } = await admin.from("positions").select("id, title, code, hospital_id, department_id, template_id, supervisor_position_id, status").eq("id", input.positionId).maybeSingle();
  if (!pos) return { error: "Position not found" };
  if (pos.status !== "active") return { error: "Position is not active" };

  const { data: tpl } = await admin.from("position_templates").select("*").eq("id", pos.template_id).maybeSingle();
  if (!tpl) return { error: "Position template not found" };
  if (tpl.status !== "active") return { error: "Position template is not active — publish it before assigning" };

  if (!pos.hospital_id) return { error: "Position has no facility (hospital) — cannot resolve tenant" };
  const { data: hosp } = await admin.from("hospitals").select("id, organisation_id").eq("id", pos.hospital_id).maybeSingle();
  if (!hosp) return { error: "Facility not found" };

  const from = input.effectiveFrom || new Date().toISOString().slice(0, 10);
  if (input.effectiveTo && input.effectiveTo < from) return { error: "End date cannot be before the start date" };
  if ((input.assignmentType === "temporary" || input.assignmentType === "acting") && !input.effectiveTo) {
    return { error: "Temporary and acting assignments require an end date" };
  }
  return { emp, pos, tpl, hosp, from };
}

export async function provisionAssignment(admin: Admin, input: ProvisionInput): Promise<ProvisionResult> {
  const steps: StepResult[] = [];
  const step = (s: string, ok: boolean, detail?: string) => { steps.push({ step: s, ok, detail }); };
  const actor = { actor_id: input.actorId, actor_name: input.actorName ?? null };

  const v = await validate(admin, input);
  if ("error" in v) return { ok: false, status: "failed", steps: [{ step: "validate", ok: false, detail: v.error }], error: v.error };
  const { emp, pos, tpl, hosp, from } = v as any;
  step("validate", true, `${emp.full_name} → ${pos.title}`);

  const hospitalId: string = pos.hospital_id;
  const orgId: string | null = hosp.organisation_id ?? emp.organisation_id ?? null;
  const assignmentType = input.assignmentType ?? "permanent";

  // ── Create or reuse the assignment record (idempotent per employee+position)
  let assignmentId: string;
  const { data: existing } = await admin.from("workforce_assignments")
    .select("id, provisioned").eq("employee_id", input.employeeId).eq("position_id", input.positionId).eq("status", "active").maybeSingle();
  const provisioned: Record<string, unknown> = (existing?.provisioned as Record<string, unknown>) ?? {};
  if (existing) {
    assignmentId = existing.id;
  } else {
    const { data: created, error } = await admin.from("workforce_assignments").insert({
      employee_id: input.employeeId, position_id: input.positionId, template_id: tpl.id,
      assignment_type: assignmentType, is_primary: input.isPrimary ?? true,
      effective_from: from, effective_to: input.effectiveTo ?? null,
      status: "active", provisioning_status: "pending", created_by: input.actorId,
    }).select("id").single();
    if (error || !created) return { ok: false, status: "failed", steps, error: error?.message ?? "Could not create assignment" };
    assignmentId = created.id;
  }
  step("assignment", true, existing ? "reused active assignment" : "created assignment");

  // ── 1. Organisational context — bind the employee to the position's tenant
  try {
    await admin.from("profiles").update({ hospital_id: hospitalId, department_id: pos.department_id ?? null, organisation_id: orgId }).eq("id", input.employeeId);
    step("context", true, "employee bound to facility/department");
  } catch (e: any) { step("context", false, e?.message); }

  // ── 2. Workspaces (portal roles) — dedup via workspace_registry unique key
  try {
    const wss: string[] = (tpl.workspaces ?? []).filter((w: string) => WORKSPACE_KEYS.includes(w));
    for (const ws of wss) {
      await admin.from("workspace_registry").upsert(
        { employee_id: input.employeeId, workspace_type: ws, status: "active", source_assignment_id: assignmentId, archived_date: null },
        { onConflict: "employee_id,workspace_type" },
      );
    }
    const roles = await recomputeRoles(admin, input.employeeId);
    provisioned.workspaces = wss;
    step("workspaces", true, `provisioned ${wss.join(", ") || "none"} · roles now [${roles.join(", ")}]`);
    for (const ws of wss) await audit(admin, { ...actor, action: "provision_workspace", entity_type: "workspace", entity_id: input.employeeId, entity_name: ws, hospital_id: hospitalId, new_value: { assignment_id: assignmentId } });
  } catch (e: any) { step("workspaces", false, e?.message); }

  // ── 3. Competencies — a cycle + its frameworks (dedup existing cycle_frameworks)
  try {
    let cycleId = (provisioned.cycle_id as string) ?? null;
    if (!cycleId) {
      const { data: cyc } = await admin.from("competency_cycles").insert({
        nurse_id: input.employeeId, hospital_id: hospitalId, cycle_type: tpl.cycle_type ?? "orientation", created_by: input.actorId,
      }).select("id").single();
      cycleId = cyc?.id ?? null;
    }
    const fwIds: string[] = tpl.framework_ids ?? [];
    if (cycleId && fwIds.length) {
      const { data: have } = await admin.from("cycle_frameworks").select("framework_id").eq("cycle_id", cycleId);
      const haveSet = new Set((have ?? []).map((r: any) => r.framework_id));
      const toAdd = fwIds.filter(f => !haveSet.has(f)).map(f => ({ cycle_id: cycleId, framework_id: f }));
      if (toAdd.length) await admin.from("cycle_frameworks").insert(toAdd);
    }
    provisioned.cycle_id = cycleId;
    step("competencies", true, `cycle ${cycleId ? "ready" : "skipped"} · ${fwIds.length} framework(s)`);
    await audit(admin, { ...actor, action: "provision_competencies", entity_type: "competency_cycle", entity_id: cycleId, entity_name: pos.title, hospital_id: hospitalId, new_value: { frameworks: fwIds.length } });
  } catch (e: any) { step("competencies", false, e?.message); }

  // ── 4. Learning — an onboarding pathway + its resources (dedup by pathway+resource)
  try {
    const resIds: string[] = tpl.resource_ids ?? [];
    if (resIds.length) {
      let pathwayId = (provisioned.pathway_id as string) ?? null;
      if (!pathwayId) {
        const { data: existingPw } = await admin.from("learning_pathways").select("id").eq("nurse_id", input.employeeId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (existingPw) { pathwayId = existingPw.id; }
        else {
          const { data: pw } = await admin.from("learning_pathways").insert({ nurse_id: input.employeeId, title: `Onboarding — ${pos.title}` }).select("id").single();
          pathwayId = pw?.id ?? null;
        }
      }
      if (pathwayId) {
        const { data: have } = await admin.from("pathway_items").select("resource_id").eq("pathway_id", pathwayId);
        const haveSet = new Set((have ?? []).map((r: any) => r.resource_id).filter(Boolean));
        const toAdd = resIds.filter(r => !haveSet.has(r)).map((r, i) => ({ pathway_id: pathwayId, resource_id: r, status: "pending", reason: "Onboarding", sort_order: i }));
        if (toAdd.length) await admin.from("pathway_items").insert(toAdd);
        provisioned.pathway_id = pathwayId;
      }
    }
    step("learning", true, `${resIds.length} resource(s) assigned`);
    await audit(admin, { ...actor, action: "provision_learning", entity_type: "learning_pathway", entity_id: (provisioned.pathway_id as string) ?? null, entity_name: pos.title, hospital_id: hospitalId, new_value: { resources: resIds.length } });
  } catch (e: any) { step("learning", false, e?.message); }

  // ── 5. Assessments — a directed assessment plan (CPUs + default assessors)
  try {
    if (!provisioned.plan_id) {
      const { data: plan } = await admin.from("assessment_plans").insert({
        name: `${pos.title} — ${tpl.assessment_programme ?? "orientation"} assessment`,
        hospital_id: hospitalId, programme_type: tpl.assessment_programme ?? "orientation",
        nurse_id: input.employeeId, status: "active", created_by: input.actorId,
      }).select("id").single();
      const planId = plan?.id ?? null;
      if (planId) {
        const cpuIds: string[] = tpl.cpu_ids ?? [];
        if (cpuIds.length) await admin.from("plan_items").insert(cpuIds.map((c: string) => ({ plan_id: planId, cpu_id: c })));
        const asrIds: string[] = tpl.assessor_ids ?? [];
        if (asrIds.length) await admin.from("plan_assessors").insert(asrIds.map((a: string, i: number) => ({ plan_id: planId, assessor_id: a, role: i === 0 ? "primary" : "secondary" })));
        provisioned.plan_id = planId;
      }
    }
    step("assessments", true, provisioned.plan_id ? "assessment plan created" : "no plan (already provisioned)");
    await audit(admin, { ...actor, action: "provision_assessments", entity_type: "assessment_plan", entity_id: (provisioned.plan_id as string) ?? null, entity_name: pos.title, hospital_id: hospitalId });
  } catch (e: any) { step("assessments", false, e?.message); }

  // ── 6. Passport — a lifetime employment record
  try {
    const empStatus = assignmentType === "temporary" ? "temporary_assignment"
      : assignmentType === "acting" ? "secondment"
      : tpl.cycle_type === "orientation" ? "orientation"
      : tpl.cycle_type === "probation" ? "probation" : "confirmed";
    const { data: haveEr } = await admin.from("employment_records").select("id").eq("nurse_id", input.employeeId).eq("hospital_id", hospitalId).is("end_date", null).limit(1).maybeSingle();
    if (!haveEr) {
      const { data: er } = await admin.from("employment_records").insert({
        nurse_id: input.employeeId, organisation_id: orgId, hospital_id: hospitalId, department_id: pos.department_id ?? null,
        role_title: pos.title, status: empStatus, start_date: from,
      }).select("id").single();
      provisioned.employment_record_id = er?.id ?? null;
    } else { provisioned.employment_record_id = haveEr.id; }
    step("passport", true, haveEr ? "employment record present" : "employment record created");
    await audit(admin, { ...actor, action: "provision_passport", entity_type: "employment_record", entity_id: (provisioned.employment_record_id as string) ?? null, entity_name: pos.title, hospital_id: hospitalId });
  } catch (e: any) { step("passport", false, e?.message); }

  // ── 7. Notifications — employee + supervisor
  try {
    await notify([input.employeeId], {
      type: "workforce_assigned",
      title: `You've been assigned: ${pos.title}`,
      body: `Your ${pos.title} workspace, learning and assessments have been set up. Welcome aboard.`,
      href: "/dashboard",
    });
    if (pos.supervisor_position_id) {
      const { data: sup } = await admin.from("workforce_assignments").select("employee_id").eq("position_id", pos.supervisor_position_id).eq("status", "active").limit(1).maybeSingle();
      if (sup?.employee_id && sup.employee_id !== input.employeeId) {
        await notify([sup.employee_id], { type: "workforce_report", title: `New team member: ${emp.full_name}`, body: `${emp.full_name} has been assigned as ${pos.title}.`, href: "/admin/positions" });
      }
    }
    step("notifications", true, "employee notified");
  } catch (e: any) { step("notifications", false, e?.message); }

  // ── Finalize
  const okAll = steps.every(s => s.ok);
  const status: ProvisionResult["status"] = steps[0]?.ok === false ? "failed" : okAll ? "complete" : "partial";
  await admin.from("workforce_assignments").update({ provisioning_status: status, provisioned, provisioned_at: new Date().toISOString() }).eq("id", assignmentId);
  await audit(admin, { ...actor, action: "assign_position", entity_type: "workforce_assignment", entity_id: assignmentId, entity_name: `${emp.full_name} → ${pos.title}`, hospital_id: hospitalId, new_value: { assignment_type: assignmentType, status, steps: steps.map(s => `${s.step}:${s.ok ? "ok" : "fail"}`) } });

  return { ok: status !== "failed", assignmentId, status, steps };
}

// Terminate an assignment (offboard/transfer): archive its workspaces where no
// other active assignment still grants them, recompute roles, close the
// employment record, notify and audit. History is preserved, never deleted.
export async function terminateAssignment(admin: Admin, assignmentId: string, actorId: string, actorName?: string | null, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const { data: a } = await admin.from("workforce_assignments").select("id, employee_id, position_id, template_id, status").eq("id", assignmentId).maybeSingle();
  if (!a) return { ok: false, error: "Assignment not found" };
  if (a.status === "ended") return { ok: true };

  const { data: tpl } = await admin.from("position_templates").select("workspaces").eq("id", a.template_id).maybeSingle();
  const myWs: string[] = tpl?.workspaces ?? [];

  // Which workspaces are still granted by OTHER active assignments of this employee?
  const { data: others } = await admin.from("workforce_assignments").select("template_id").eq("employee_id", a.employee_id).eq("status", "active").neq("id", assignmentId);
  const otherTplIds = [...new Set((others ?? []).map((o: any) => o.template_id).filter(Boolean))];
  const stillGranted = new Set<string>();
  if (otherTplIds.length) {
    const { data: otherTpls } = await admin.from("position_templates").select("workspaces").in("id", otherTplIds);
    for (const t of otherTpls ?? []) for (const w of (t.workspaces ?? [])) stillGranted.add(w);
  }
  const toArchive = myWs.filter(w => !stillGranted.has(w));
  for (const w of toArchive) {
    await admin.from("workspace_registry").update({ status: "archived", archived_date: new Date().toISOString() }).eq("employee_id", a.employee_id).eq("workspace_type", w);
  }

  await admin.from("workforce_assignments").update({ status: "ended", effective_to: new Date().toISOString().slice(0, 10) }).eq("id", assignmentId);
  const roles = await recomputeRoles(admin, a.employee_id);

  // Close the open employment record for this position's facility.
  const { data: pos } = await admin.from("positions").select("hospital_id, title").eq("id", a.position_id).maybeSingle();
  if (pos?.hospital_id) {
    await admin.from("employment_records").update({ end_date: new Date().toISOString().slice(0, 10), status: "contract_ended" })
      .eq("nurse_id", a.employee_id).eq("hospital_id", pos.hospital_id).is("end_date", null);
  }

  await audit(admin, { actor_id: actorId, actor_name: actorName ?? null, action: "terminate_assignment", entity_type: "workforce_assignment", entity_id: assignmentId, entity_name: pos?.title ?? "assignment", hospital_id: pos?.hospital_id ?? null, new_value: { archived_workspaces: toArchive, roles_now: roles, reason: reason ?? null } });
  try { await notify([a.employee_id], { type: "workforce_ended", title: "Assignment ended", body: `Your ${pos?.title ?? "position"} assignment has ended.${reason ? " " + reason : ""}`, href: "/dashboard" }); } catch {}

  return { ok: true };
}
