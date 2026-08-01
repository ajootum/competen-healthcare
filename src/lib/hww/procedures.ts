// Clinical procedures for the bedside nurse (HWW-UI-005 s1, migration 184).
//
// The module used to be a greyed sidebar row. The spec asks for it to be permanently active, with an empty
// state rather than a disabled state -- because "no procedures due" and "this feature does not exist" are
// different facts and a grey row says the wrong one.
//
// So this loader distinguishes THREE states, and the page renders each differently:
//   ready:false            the table is absent (migration 184 not applied) -> "Coming soon", honestly named
//   ready:true, empty      nothing due -> "No procedures due" + Record Procedure
//   ready:true, rows       the work
// Collapsing the first two into one empty state would tell a clinician their ward has no procedures due
// when in fact nothing is being recorded at all.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type ProcedureRow = {
  id: string; procedure_name: string; procedure_code: string | null; category: string; status: string;
  scheduled_for: string | null; started_at: string | null; completed_at: string | null;
  performed_by_name: string | null; site: string | null; laterality: string | null;
  consent_obtained: boolean | null; outcome: string | null; complications: string | null; notes: string | null;
  patient_id: string | null; op_patients?: { label: string | null; op_beds?: { label: string | null } | null } | null;
};

export const OPEN_STATUSES = ["planned", "due", "in_progress"];

export type ProceduresView = {
  ready: boolean;
  reason: string | null;
  due: ProcedureRow[];
  recent: ProcedureRow[];
  stats: { due: number; inProgress: number; completedToday: number; withComplications: number };
};

const EMPTY: ProceduresView = {
  ready: false, reason: null, due: [], recent: [],
  stats: { due: 0, inProgress: 0, completedToday: 0, withComplications: 0 },
};

export async function loadMyProcedures(admin: any, patientIds: string[]): Promise<ProceduresView> {
  // Existence probed with a PLAIN select, never head+count: a HEAD request against a missing table returns
  // 204 with a null count and no error, which is indistinguishable from an empty table. That trap has
  // already cost this codebase a wrong answer once.
  const probe = await admin.from("op_procedures").select("id").limit(1);
  if (probe.error) {
    return { ...EMPTY, reason: "Run migration 184 to record clinical procedures." };
  }
  if (!patientIds.length) return { ...EMPTY, ready: true };

  const cols = "id, procedure_name, procedure_code, category, status, scheduled_for, started_at, completed_at, performed_by_name, site, laterality, consent_obtained, outcome, complications, notes, patient_id, op_patients!patient_id(label, op_beds!bed_id(label))";
  const { data, error } = await admin.from("op_procedures").select(cols)
    .in("patient_id", patientIds)
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) return { ...EMPTY, reason: error.message };

  const rows = (data ?? []) as ProcedureRow[];
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const due = rows.filter(r => OPEN_STATUSES.includes(r.status));
  const recent = rows.filter(r => !OPEN_STATUSES.includes(r.status)).slice(0, 25);

  return {
    ready: true,
    reason: null,
    due,
    recent,
    stats: {
      due: due.filter(r => r.status !== "in_progress").length,
      inProgress: due.filter(r => r.status === "in_progress").length,
      completedToday: rows.filter(r => r.status === "completed" && r.completed_at && +new Date(r.completed_at) >= +startOfDay).length,
      // Surfaced on the page rather than buried in a row: a complication recorded and never looked at
      // again is the failure mode this record exists to prevent.
      withComplications: rows.filter(r => !!r.complications).length,
    },
  };
}
