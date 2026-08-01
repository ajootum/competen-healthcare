// Command palette search (HWW-UI-005 s18).
//
// THE SAFETY PROPERTY THIS FILE EXISTS TO HOLD: a bedside clinician can only find their OWN patients, and
// only records belonging to those patients. A global search box is the easiest place in a hospital system
// to accidentally build a patient browser -- one forgotten predicate and typing three letters returns the
// whole ward. So the assigned-patient id list is resolved FIRST and every record query is constrained to
// it; there is no code path here that queries a patient table by name without that constraint.
//
// Staff tier is NOT given a wider net here either. This is the bedside palette; a coordinator who needs
// the unit-wide view has the supervisor workspace, which enforces its own scope. Widening this one would
// mean two different answers to "what may I see" depending on which box you typed into.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type CommandHit = {
  kind: "module" | "patient" | "record" | "action";
  label: string;
  sub?: string | null;
  href: string;
  icon: string;
};

export type CommandResults = { hits: CommandHit[]; scopedPatients: number; truncated: boolean };

const PER_GROUP = 5;
// Postgrest `ilike` is fed a user string; escape the wildcards so a query of "%" does not match everything.
const like = (q: string) => `%${q.replace(/[\\%_]/g, ch => "\\" + ch)}%`;

export async function commandSearch(
  admin: any,
  userId: string,
  q: string,
  modules: { key: string; label: string; href?: string; icon: string }[],
): Promise<CommandResults> {
  const term = q.trim();
  if (term.length < 2) return { hits: [], scopedPatients: 0, truncated: false };
  const needle = term.toLowerCase();

  // Modules come from the RESOLVED nav, so anything a hospital has disabled through the WCE, or that this
  // person's role does not admit, is not findable here either. A palette that could reach a module the
  // sidebar hides would be a second, unconfigured way in.
  const moduleHits: CommandHit[] = modules
    .filter(m => m.href && m.label.toLowerCase().includes(needle))
    .slice(0, PER_GROUP)
    .map(m => ({ kind: "module" as const, label: m.label, sub: "Module", href: m.href!, icon: m.icon }));

  const { data: asg } = await admin.from("op_patient_assignments")
    .select("patient_id, op_patients!patient_id(id, label, acuity_level, op_beds!bed_id(label))")
    .eq("staff_id", userId).eq("status", "active").limit(100);
  const rows = (asg ?? []) as any[];
  const ids = rows.map(r => r.patient_id).filter(Boolean) as string[];

  const patientHits: CommandHit[] = rows
    .filter(r => String(r.op_patients?.label ?? "").toLowerCase().includes(needle))
    .slice(0, PER_GROUP)
    .map(r => ({
      kind: "patient" as const,
      label: r.op_patients?.label ?? "Patient",
      sub: [r.op_patients?.op_beds?.label, r.op_patients?.acuity_level].filter(Boolean).join(" · ") || null,
      href: `/healthcare-worker/patients?patient=${r.patient_id}`,
      icon: "🧑‍⚕️",
    }));

  // Records: only ever `.in("patient_id", ids)`. With no assignments the queries are skipped entirely
  // rather than run unconstrained -- an empty `in()` list is the kind of thing that quietly becomes "all".
  let recordHits: CommandHit[] = [];
  if (ids.length) {
    const soft = (p: Promise<any>) => p.then((r: any) => (r?.error ? { data: [] } : r), () => ({ data: [] }));
    const [proc, meds, tasks, inc] = await Promise.all([
      soft(admin.from("op_procedures").select("id, procedure_name, status, patient_id")
        .in("patient_id", ids).ilike("procedure_name", like(term)).limit(PER_GROUP)),
      // Column names VERIFIED against the live schema, not assumed: the first draft searched
      // `medication_name` and `title`, which are `drug_name` and `description` here. Because the wrapper
      // above swallows query errors so one bad table cannot blank the palette, both would have returned
      // nothing forever and looked exactly like "no matches".
      soft(admin.from("op_med_schedule").select("id, drug_name, dose_display, status, patient_id")
        .in("patient_id", ids).ilike("drug_name", like(term)).limit(PER_GROUP)),
      soft(admin.from("op_tasks").select("id, description, status")
        .eq("assigned_to", userId).ilike("description", like(term)).limit(PER_GROUP)),
      soft(admin.from("op_incidents").select("id, description, incident_type")
        .in("patient_id", ids).ilike("description", like(term)).limit(PER_GROUP)),
    ]);
    recordHits = [
      ...((proc.data ?? []) as any[]).map(r => ({ kind: "record" as const, label: r.procedure_name, sub: `Procedure · ${r.status}`, href: "/healthcare-worker/procedures", icon: "🩹" })),
      ...((meds.data ?? []) as any[]).map(r => ({ kind: "record" as const, label: [r.drug_name, r.dose_display].filter(Boolean).join(" ") || "Medication", sub: `Medication · ${r.status}`, href: "/healthcare-worker/medications", icon: "💊" })),
      ...((tasks.data ?? []) as any[]).map(r => ({ kind: "record" as const, label: (r.description ?? "Task").slice(0, 70), sub: `Task · ${r.status}`, href: "/healthcare-worker/tasks", icon: "✅" })),
      ...((inc.data ?? []) as any[]).map(r => ({ kind: "record" as const, label: (r.description ?? "Incident").slice(0, 70), sub: `Incident · ${r.incident_type}`, href: "/healthcare-worker/safety?event=incidents", icon: "🚩" })),
    ];
  }

  // Actions are the s17 quick actions, reachable by name so "record a procedure" finds the form rather
  // than only the list.
  const ACTIONS: CommandHit[] = [
    { kind: "action", label: "Record procedure", sub: "Action", href: "/healthcare-worker/procedures", icon: "🩹" },
    { kind: "action", label: "Record assessment", sub: "Action", href: "/healthcare-worker/observations", icon: "🩺" },
    { kind: "action", label: "Raise concern", sub: "Action", href: "/healthcare-worker/concerns", icon: "⚠️" },
    { kind: "action", label: "Report incident", sub: "Action", href: "/healthcare-worker/safety?event=incidents", icon: "🚩" },
    { kind: "action", label: "Start handover", sub: "Action", href: "/healthcare-worker/handover", icon: "🔁" },
  ];
  const actionHits = ACTIONS.filter(a => a.label.toLowerCase().includes(needle)).slice(0, PER_GROUP);

  // Patients first: mid-shift the overwhelming majority of searches are for a person.
  const hits = [...patientHits, ...actionHits, ...moduleHits, ...recordHits];
  return { hits: hits.slice(0, 20), scopedPatients: ids.length, truncated: hits.length > 20 };
}
