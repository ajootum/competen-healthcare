// Human Resources Workspace data (HRM-001) — headcount, employment status,
// establishment/vacancy (from the Workforce Assignment Engine), new starters,
// competency compliance and mandatory-learning compliance. Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];

export async function loadHrDashboard(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const since = new Date(); since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();
  const today = new Date().toISOString().slice(0, 10);

  // ── Headcount by role (mutually exclusive; nurse requires an actual nursing role)
  const headcount = { total: 0, nurse: 0, assessor: 0, educator: 0, admin: 0, other: 0 };
  try {
    const { data: staff } = await scope(admin.from("profiles").select("role, roles").limit(8000));
    const rows = staff ?? [];
    headcount.total = rows.length;
    for (const p of rows) {
      const rs: string[] = (p.roles?.length ? p.roles : [p.role]).filter(Boolean);
      if (rs.includes("educator")) headcount.educator++;
      else if (rs.includes("assessor")) headcount.assessor++;
      else if (rs.includes("hospital_admin") || rs.includes("super_admin")) headcount.admin++;
      else if (rs.includes("nurse")) headcount.nurse++;
      else headcount.other++;
    }
  } catch { /* ignore */ }

  // ── Employment lifecycle — the CURRENT record per employee (lifetime passport
  // holds many rows per person, so dedupe to the latest and count distinct people)
  const employment = { active: 0, orientation: 0, probation: 0, confirmed: 0, newStarters: 0 };
  try {
    const { data: er } = await scope(admin.from("employment_records").select("nurse_id, status, start_date, end_date").order("start_date", { ascending: false }).limit(8000));
    const latest = new Map<string, any>();
    for (const e of er ?? []) { if (!latest.has(e.nurse_id)) latest.set(e.nurse_id, e); }
    const active = [...latest.values()].filter((e: any) => !e.end_date);
    employment.active = active.length;
    employment.orientation = active.filter((e: any) => e.status === "orientation").length;
    employment.probation = active.filter((e: any) => e.status === "probation").length;
    employment.confirmed = active.filter((e: any) => e.status === "confirmed").length;
    employment.newStarters = active.filter((e: any) => e.start_date && e.start_date >= sinceIso.slice(0, 10)).length;
  } catch { /* pre-migration */ }

  // ── Establishment & vacancy (Workforce Assignment Engine)
  const positions = { establishment: 0, filled: 0, vacant: 0, recentAssignments: 0 };
  try {
    const { data: pos } = await scope(admin.from("positions").select("id").eq("status", "active").limit(3000));
    const posIds = (pos ?? []).map((p: any) => p.id);
    positions.establishment = posIds.length;
    if (posIds.length) {
      const { data: asg } = await admin.from("workforce_assignments").select("position_id, created_at").eq("status", "active").in("position_id", posIds).limit(5000);
      const filled = new Set((asg ?? []).map((a: any) => a.position_id));
      positions.filled = filled.size;
      positions.vacant = Math.max(0, positions.establishment - filled.size);
      positions.recentAssignments = (asg ?? []).filter((a: any) => a.created_at && a.created_at >= sinceIso).length;
    }
  } catch {
    // Keep the establishment/filled/vacant triple internally consistent if any
    // query in this block fails partway through.
    positions.establishment = 0; positions.filled = 0; positions.vacant = 0; positions.recentAssignments = 0;
  }

  // ── Competency compliance (hospital-scoped decisions)
  const competency = { total: 0, current: 0, coverage: 0 };
  try {
    const { data: decs } = await scope(admin.from("competency_decisions").select("nurse_id, competency_id, outcome, expiry_date, created_at").order("created_at", { ascending: false }).limit(20000));
    const seen = new Set<string>(); const latest: any[] = [];
    for (const d of decs ?? []) { const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k); latest.push(d); }
    const current = latest.filter(d => PASSING.includes(d.outcome) && (!d.expiry_date || d.expiry_date >= today)).length;
    competency.total = latest.length;
    competency.current = current;
    competency.coverage = latest.length ? Math.round((current / latest.length) * 100) : 0;
  } catch { /* pre-migration */ }

  // ── Mandatory learning compliance (pathway completion across the workforce)
  const learning = { total: 0, completed: 0, compliance: 0 };
  try {
    // Match the headcount definition of a nurse — scalar role OR nurse in roles[].
    const { data: nurses } = await scope(admin.from("profiles").select("id").or("role.eq.nurse,roles.cs.{nurse}").limit(4000));
    const nurseIds = (nurses ?? []).map((n: any) => n.id);
    if (nurseIds.length) {
      const { data: pws } = await admin.from("learning_pathways").select("id").in("nurse_id", nurseIds).limit(4000);
      const pwIds = (pws ?? []).map((p: any) => p.id);
      if (pwIds.length) {
        const { data: items } = await admin.from("pathway_items").select("status").in("pathway_id", pwIds).limit(20000);
        learning.total = (items ?? []).length;
        learning.completed = (items ?? []).filter((i: any) => i.status === "completed").length;
        learning.compliance = learning.total ? Math.round((learning.completed / learning.total) * 100) : 0;
      }
    }
  } catch { /* ignore */ }

  return { headcount, employment, positions, competency, learning };
}
