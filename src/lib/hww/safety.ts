// Safety & Escalation loader (HWW-WARD-001 S4.9 / HWW-SAF-001) — the nurse's
// safety picture: active alerts and open escalations on MY patients or raised/
// owned by me (the frontline ownership scope, mirroring the relaxed GET
// routes), plus incidents I reported in the last 7 days. Clock-derived fields
// computed here so pages stay render-pure.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function loadMySafety(admin: any, userId: string, now = Date.now()) {
  const { data: asg } = await admin.from("op_patient_assignments")
    .select("patient_id, op_patients!patient_id(id, label)").eq("staff_id", userId).eq("status", "active").limit(100);
  const mine = ((asg ?? []) as any[]).map(r => r.patient_id).filter(Boolean);

  const alertLegs = [`created_by.eq.${userId}`, `owner_id.eq.${userId}`];
  const escLegs = [`raised_by.eq.${userId}`, `assigned_responder.eq.${userId}`];
  if (mine.length) {
    alertLegs.push(`patient_id.in.(${mine.join(",")})`);
    escLegs.push(`patient_id.in.(${mine.join(",")})`);
  }

  const weekBack = new Date(now - 7 * 24 * 3.6e6).toISOString();
  const [alertsRes, escRes, incRes] = await Promise.all([
    admin.from("op_safety_alerts").select("*, op_patients!patient_id(label)")
      .eq("active", true).or(alertLegs.join(","))
      .order("severity", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    admin.from("op_escalations").select("*, op_patients!patient_id(label), profiles!raised_by(full_name)")
      .neq("status", "resolved").neq("status", "cancelled").or(escLegs.join(","))
      .order("level", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    admin.from("op_incidents").select("*, op_patients!patient_id(label)")
      .eq("reported_by", userId).gte("created_at", weekBack)
      .order("created_at", { ascending: false }).limit(50),
  ]);

  const escalations = (escRes.data ?? []).map((e: any) => ({
    ...e,
    deadline_passed: !!(e.response_deadline && +new Date(e.response_deadline) < now && e.status === "open"),
  }));

  return {
    patients: ((asg ?? []) as any[]).filter(r => r.op_patients).map(r => ({ id: r.op_patients.id, label: r.op_patients.label })),
    alerts: alertsRes.data ?? [],
    escalations,
    incidents: incRes.data ?? [],
    kpis: {
      activeAlerts: (alertsRes.data ?? []).length,
      openEscalations: escalations.filter((e: any) => e.status === "open").length,
      breachedDeadlines: escalations.filter((e: any) => e.deadline_passed).length,
      myIncidents7d: (incRes.data ?? []).length,
    },
  };
}
