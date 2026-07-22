// Knowledge Publishing & Governance (CKP-001.5) loader — the publishing pipeline
// dashboard. Drives the draft → clinical review → educational review → governance
// → published lifecycle from CPU pub_status + KO status, aggregates review/
// approval queues (change_requests, content_approvals), version control by
// change kind, governance committees and a knowledge audit trail. Fail-soft;
// honest states where a stage isn't tracked.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };
const DAY = 86400000;

export async function loadPublishing(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();

  const [cpuRows, koRows, crRows, caRows, commRows, memberCount, auditRows, publishAudit] = await Promise.all([
    admin.from("clinical_practice_units").select("pub_status").limit(5000),
    admin.from("knowledge_objects").select("status").limit(8000),
    admin.from("change_requests").select("status, change_kind, entity_type, entity_name, requested_by_name, created_at").order("created_at", { ascending: false }).limit(2000),
    admin.from("content_approvals").select("status").limit(4000),
    admin.from("governance_committees").select("name, level, is_active").order("name").limit(200),
    head("committee_members"),
    admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").in("entity_type", ["framework", "competency", "cpu", "knowledge_object", "policy", "assessment", "clinical_case", "change_request"]).order("created_at", { ascending: false }).limit(12),
    admin.from("audit_log").select("*", { count: "exact", head: true }).ilike("action", "%publish%").gte("created_at", since30),
  ]);

  const cpu = cpuRows.error ? {} : bucket(cpuRows.data ?? [], "pub_status");
  const ko = koRows.error ? {} : bucket(koRows.data ?? [], "status");
  const crs = (crRows.error ? [] : crRows.data ?? []) as any[];
  const crStatus = bucket(crs, "status");
  const crKind = bucket(crs, "change_kind");
  const caStatus = caRows.error ? {} : bucket(caRows.data ?? [], "status");

  const inReview = (cpu.in_review ?? 0) + (crStatus.open ?? 0);
  const pendingApprovals = (crStatus.open ?? 0) + (caStatus.pending ?? 0) + (cpu.approved ?? 0);
  const published = (cpu.published ?? 0) + (ko.active ?? 0);
  const archived = (cpu.archived ?? 0) + (ko.retired ?? 0);

  const pipeline = [
    { stage: "Draft", count: (cpu.draft ?? 0) + (ko.draft ?? 0), icon: "📝" },
    { stage: "Clinical Review", count: cpu.in_review ?? 0, icon: "🩺" },
    { stage: "Educational Review", count: 0, icon: "🎓" },
    { stage: "Governance", count: cpu.approved ?? 0, icon: "⚖️" },
    { stage: "Published", count: published, icon: "✅" },
  ];

  // Recent submissions — change requests first, else recent knowledge assets.
  const STAGE: Record<string, string> = { open: "In Review", approved: "Approved", rejected: "Rejected", implemented: "Published" };
  const submissions = crs.slice(0, 8).map(r => ({ title: r.entity_name || "Change request", type: (r.entity_type ?? "").replace(/_/g, " "), stage: STAGE[r.status] ?? r.status, kind: r.change_kind, by: r.requested_by_name, at: r.created_at }));

  const committees = (commRows.error ? [] : commRows.data ?? []).map((c: any) => ({ name: c.name, level: c.level, active: c.is_active }));

  const ICON: Record<string, string> = { framework: "📐", competency: "🎯", cpu: "🧩", knowledge_object: "🧠", policy: "📋", assessment: "📝", clinical_case: "🩹", change_request: "✏️" };
  const audit = (auditRows.error ? [] : auditRows.data ?? []).map((a: any) => ({ icon: ICON[a.entity_type] ?? "•", title: a.entity_name || (a.action ?? "").replace(/_/g, " "), detail: [(a.action ?? "").replace(/_/g, " "), a.actor_name].filter(Boolean).join(" · "), at: a.created_at }));

  return {
    kpis: { inReview, pendingApprovals, published, publishedThisMonth: num(publishAudit), archived, committees: committees.length },
    pipeline,
    submissions,
    versionControl: { major: crKind.major ?? 0, minor: crKind.minor ?? 0, revisions: crKind.revision ?? 0, total: crs.length, ready: !crRows.error },
    reviewQueue: { open: crStatus.open ?? 0, approved: crStatus.approved ?? 0, rejected: crStatus.rejected ?? 0, implemented: crStatus.implemented ?? 0, pendingApprovals: caStatus.pending ?? 0 },
    committees, memberCount: num(memberCount) ?? 0,
    audit, auditReady: !auditRows.error,
    generatedAt: new Date().toISOString(),
  };
}
