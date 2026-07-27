// OGS-004 Meetings, Decisions & Governance Centre. Grounds the DECISIONS side in the real governance
// registers: change_requests (012) = the governance decision / change register (organisation-GLOBAL, no
// hospital_id), and the platform approval engine plat_approval_requests / plat_approval_decisions (057) =
// the multi-step approval / decision queue. Meetings, agendas, attendance, quorum, minutes and formal
// voting have NO store yet — they are the entirely next-phase OGS-004 engine (nothing is fabricated here).
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function loadOgsDecisions(admin: any, hid: string | null, isSuper: boolean) {
  // change_requests + the platform approval engine are organisation-GLOBAL (no hospital_id) — this
  // governance decision register is intentionally cross-facility. We accept the OGS scope (isSuper / hid)
  // for kit parity and state the lens honestly rather than silently narrowing a global register.
  const scopeNote = isSuper ? "Organisation-wide · all facilities" : `Organisation-wide · not narrowed by ${hid ? "the selected facility" : "facility"}`;

  // PRIMARY read — change_requests (the governance decision / change register). Global, no scope.
  const { data: crRows, error } = await admin.from("change_requests")
    .select("entity_type, entity_id, entity_name, change_kind, status, requested_by_name, effective_date, created_at")
    .order("created_at", { ascending: false }).limit(2000);
  if (error) return { provisioned: false as const };
  const decisions = (crRows ?? []) as any[];

  const total = decisions.length;
  const cnt = (s: string) => decisions.filter(d => d.status === s).length;
  const approved = cnt("approved");
  const implemented = cnt("implemented");
  const rejected = cnt("rejected");
  const open = cnt("open");

  // Approval engine (platform-global). Optional — its absence must not break the decisions module.
  let approvalRequests: any[] = [];
  try {
    const { data } = await admin.from("plat_approval_requests")
      .select("id, workflow_key, entity_type, entity_name, status, current_step, total_steps, requested_by_name, created_at")
      .order("created_at", { ascending: false }).limit(1000);
    approvalRequests = (data ?? []) as any[];
  } catch { /* approval engine optional */ }
  const pendingApprovals = approvalRequests.filter(r => r.status === "pending");

  let approvalDecisions: any[] = [];
  try {
    const { data } = await admin.from("plat_approval_decisions")
      .select("request_id, step, decision, actor_name, note, created_at")
      .order("created_at", { ascending: false }).limit(200);
    approvalDecisions = (data ?? []) as any[];
  } catch { /* approval engine optional */ }

  // KPIs. Pending = open change requests + approvals awaiting a decision. Implementation rate guards /0.
  const pending = open + pendingApprovals.length;
  const implementationRate = (approved + implemented) ? Math.round((implemented / (approved + implemented)) * 100) : null;

  // Decision register — most recent change_requests (item · kind · requested-by · date · status).
  const register = decisions.slice(0, 14).map(d => ({
    item: d.entity_name ?? d.entity_type ?? "—",
    kind: d.change_kind ?? "minor",
    requestedBy: d.requested_by_name ?? "—",
    date: d.effective_date ?? (d.created_at ? String(d.created_at).slice(0, 10) : "—"),
    dated: d.effective_date ? "effective" : "created",
    status: d.status ?? "open",
  }));

  // Decisions-by-kind (donut + legend). change_kind is CHECK-constrained to these three.
  const byKind = [
    { label: "Major", value: decisions.filter(d => d.change_kind === "major").length, tone: "rose" },
    { label: "Minor", value: decisions.filter(d => d.change_kind === "minor").length, tone: "blue" },
    { label: "Revision", value: decisions.filter(d => d.change_kind === "revision").length, tone: "amber" },
  ];

  // Decisions-by-status (bars) — count + share of the whole register.
  const statusBars = [
    { label: "Open", value: open, tone: "amber" },
    { label: "Approved", value: approved, tone: "emerald" },
    { label: "Implemented", value: implemented, tone: "teal" },
    { label: "Rejected", value: rejected, tone: "rose" },
  ].map(s => ({ label: s.label, value: s.value, tone: s.tone, pct: total ? Math.round((s.value / total) * 100) : 0 }));

  // Approval queue — pending plat_approval_requests (workflow_key humanised, step X/Y).
  const queue = pendingApprovals.slice(0, 10).map(r => ({
    item: r.entity_name ?? r.entity_type ?? "—",
    workflow: String(r.workflow_key ?? "—").replace(/_/g, " "),
    step: `${Number(r.current_step ?? 0)}/${Number(r.total_steps ?? 1)}`,
    requestedBy: r.requested_by_name ?? "—",
  }));

  // Recent approval decisions — most recent plat_approval_decisions.
  const recentDecisions = approvalDecisions.slice(0, 8).map(d => ({
    decision: d.decision ?? "—",
    actor: d.actor_name ?? "—",
    note: d.note ?? "—",
    when: d.created_at ? String(d.created_at).slice(0, 10) : "—",
  }));

  return {
    provisioned: true as const,
    scopeNote,
    kpis: { total, approved, implemented, pending, rejected, implementationRate },
    register, byKind, statusBars, queue, recentDecisions,
  };
}
