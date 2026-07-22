// Task Centre automation engine (SSW-TSK-001 §Workflow & Automation). Fires tasks
// from templates: recurrence templates generate once per interval; event templates
// scan for triggering entities (admissions, discharges/transfers, PEWS-high
// observations, incidents) created since the template's last run and generate one
// task each. last_generated_at (migration 071) is the per-template watermark that
// gates recurrence and dedupes event firing. Runs on the hourly cron (via jobs.ts)
// and on demand. Tasks are created unassigned (land in the Task Board "New" column).
/* eslint-disable @typescript-eslint/no-explicit-any */

const INTERVAL_MS: Record<string, number> = { hourly: 3600e3, per_shift: 8 * 3600e3, daily: 24 * 3600e3, weekly: 7 * 24 * 3600e3 };
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export async function runTaskAutomation(admin: any, hid: string | null = null) {
  let q = admin.from("op_task_templates").select("*").eq("active", true);
  if (hid) q = q.eq("hospital_id", hid);
  const res = await q;
  if (res.error) return { ok: false as const, provisioned: !missing(res.error), error: res.error.message, generated: 0, details: [] as string[] };

  const templates = (res.data ?? []).filter((t: any) => t.recurrence !== "none" || t.trigger_event !== "manual");
  const now = Date.now(), nowIso = new Date().toISOString();
  let generated = 0; const details: string[] = [];

  const genTask = async (t: any, patientId: string | null, desc: string) => {
    const due = new Date(now + (t.due_offset_min ?? 60) * 60000).toISOString();
    const ins = await admin.from("op_tasks").insert({
      hospital_id: t.hospital_id, patient_id: patientId, task_type: t.task_type || "general",
      description: desc, priority: t.priority, due_at: due, status: "created",
    }).select("id").single();
    if (!ins.error) generated++;
    return !ins.error;
  };

  for (const t of templates) {
    const since = t.last_generated_at ? new Date(t.last_generated_at).getTime() : 0;

    // ── Recurrence ──────────────────────────────────────────────────────────
    if (t.recurrence !== "none") {
      const iv = INTERVAL_MS[t.recurrence] ?? Infinity;
      if (now - since >= iv) {
        if (await genTask(t, null, t.description || t.name)) {
          await admin.from("op_task_templates").update({ last_generated_at: nowIso }).eq("id", t.id);
          details.push(`${t.name} · recurrence ${t.recurrence}`);
        }
      }
      continue;
    }

    // ── Event trigger ───────────────────────────────────────────────────────
    const sinceIso = t.last_generated_at ?? new Date(now - 24 * 3600e3).toISOString();
    let entities: { patientId: string | null; desc: string }[] = [];
    const scopeH = (b: any) => b.eq("hospital_id", t.hospital_id);
    if (t.trigger_event === "admission" || t.trigger_event === "discharge" || t.trigger_event === "transfer") {
      const st = t.trigger_event === "admission" ? "admitted" : t.trigger_event === "discharge" ? "discharge_pending" : "transfer_pending";
      const { data } = await scopeH(admin.from("op_patients").select("id, label, created_at")).eq("operational_status", st).gt("created_at", sinceIso).limit(50);
      entities = (data ?? []).map((p: any) => ({ patientId: p.id, desc: `${t.name} — ${p.label}` }));
    } else if (t.trigger_event === "pews_high") {
      const { data } = await scopeH(admin.from("op_observations").select("id, patient_id, ews_score, created_at, op_patients:patient_id(label)")).gte("ews_score", t.pews_threshold ?? 5).gt("created_at", sinceIso).limit(50);
      entities = (data ?? []).map((o: any) => ({ patientId: o.patient_id, desc: `${t.name} — ${o.op_patients?.label ?? "patient"} (EWS ${o.ews_score})` }));
    } else if (t.trigger_event === "incident") {
      const { data } = await scopeH(admin.from("op_safety_alerts").select("id, patient_id, created_at, op_patients:patient_id(label)")).gt("created_at", sinceIso).limit(50);
      entities = (data ?? []).map((a: any) => ({ patientId: a.patient_id, desc: `${t.name} — ${a.op_patients?.label ?? "safety alert"}` }));
    }
    // ward_round has no reliable event source yet — skipped (honest).
    let fired = 0;
    for (const e of entities.slice(0, 20)) if (await genTask(t, e.patientId, e.desc)) fired++;
    if (fired > 0) {
      await admin.from("op_task_templates").update({ last_generated_at: nowIso }).eq("id", t.id);
      details.push(`${t.name} · ${t.trigger_event} ×${fired}`);
    }
  }

  return { ok: true as const, provisioned: true, generated, details };
}
