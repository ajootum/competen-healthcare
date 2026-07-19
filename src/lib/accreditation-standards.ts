import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Accreditation & Standards (7 modules) data loader ───────────────────────
// Governance for standards compliance, evidence, regulatory mapping, audit
// readiness and improvement. The platform has NO dedicated standards catalogue,
// accreditation-report, regulatory-mapping or quality-document stores yet, so
// those modules are honest shells. Live signals come from audits (compliance +
// measurable elements), CAPA actions (improvement) and the evidence table.

export type AccreditationStandards = {
  exec: { overallCompliance: number | null; accreditationReadiness: number | null; evidenceCount: number; auditReadiness: number | null; criticalFindings: number; docsDue: null; closureRate: number | null };
  standards: {
    cards: { compliant: number; partial: null; nonCompliant: number; notAssessed: number; overall: number | null };
    byArea: { area: string; pct: number }[];
    distribution: { label: string; n: number; color: string }[];
  };
  reports: { note: string };
  evidence: {
    cards: { total: number; valid: null; awaiting: null; expired: null; missing: null };
    byType: { label: string; n: number }[];
    note: string;
  };
  mapping: { note: string };
  audit: {
    cards: { readinessScore: number | null; openFindings: number; auditsRun: number; nextAudit: null };
    byDomain: { area: string; pct: number }[];
    note: string;
  };
  documents: { note: string };
  improvement: {
    cards: { open: number; critical: number; overdue: number; completed: number; closureRate: number | null };
    bySource: { label: string; n: number }[];
    status: { label: string; n: number; color: string }[];
    items: { title: string; status: string; priority: string; due: string | null }[];
  };
};

const CLOSED = new Set(["completed", "closed", "verified"]);
const CRITICAL = new Set(["high", "critical", "urgent"]);

export async function loadAccreditationStandards(admin: Admin, hospitalId: string): Promise<AccreditationStandards> {
  const today = new Date().toISOString().slice(0, 10);
  const noRows = Promise.resolve({ data: [] as never[] });

  const [{ data: audits }, { data: capa }, { data: evidence }] = await Promise.all([
    hospitalId ? admin.from("audits").select("audit_type, area, compliance_pct, items_met, items_not_met, items_na").eq("hospital_id", hospitalId).limit(2000) : noRows,
    hospitalId ? admin.from("capa_actions").select("title, status, priority, due_date, audit_id, closed_at").eq("hospital_id", hospitalId).limit(1000) : noRows,
    hospitalId ? admin.from("evidence").select("kind").eq("hospital_id", hospitalId).limit(8000) : noRows,
  ]);

  const au = (audits ?? []) as { audit_type: string; area: string | null; compliance_pct: number | null; items_met: number | null; items_not_met: number | null; items_na: number | null }[];
  const ca = (capa ?? []) as { title: string; status: string; priority: string | null; due_date: string | null; audit_id: string | null; closed_at: string | null }[];
  const ev = (evidence ?? []) as { kind: string | null }[];

  const sum = (f: (a: typeof au[number]) => number) => au.reduce((s, a) => s + f(a), 0);
  const compliant = sum(a => a.items_met ?? 0);
  const nonCompliant = sum(a => a.items_not_met ?? 0);
  const notAssessed = sum(a => a.items_na ?? 0);
  const overall = au.length ? Math.round(au.reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / au.length) : null;

  // compliance by area
  const areaMap = new Map<string, { sum: number; n: number }>();
  for (const a of au) { const k = a.area ?? a.audit_type ?? "General"; const g = areaMap.get(k) ?? { sum: 0, n: 0 }; g.sum += a.compliance_pct ?? 0; g.n++; areaMap.set(k, g); }
  const byArea = [...areaMap.entries()].map(([area, g]) => ({ area, pct: Math.round(g.sum / g.n) })).sort((a, b) => b.pct - a.pct);

  // evidence by kind
  const kindMap = new Map<string, number>();
  for (const e of ev) kindMap.set(e.kind ?? "Other", (kindMap.get(e.kind ?? "Other") ?? 0) + 1);
  const evByType = [...kindMap.entries()].map(([label, n]) => ({ label: label.replace(/_/g, " "), n })).sort((a, b) => b.n - a.n);

  // CAPA
  const open = ca.filter(c => !CLOSED.has(c.status)).length;
  const completed = ca.filter(c => CLOSED.has(c.status)).length;
  const critical = ca.filter(c => c.priority && CRITICAL.has(c.priority) && !CLOSED.has(c.status)).length;
  const overdue = ca.filter(c => c.due_date && c.due_date < today && !CLOSED.has(c.status)).length;
  const closureRate = ca.length ? Math.round((completed / ca.length) * 100) : null;
  const srcMap = new Map<string, number>();
  for (const c of ca) { const k = c.audit_id ? "Audit Finding" : "Programme Improvement"; srcMap.set(k, (srcMap.get(k) ?? 0) + 1); }
  const statusMap = new Map<string, number>();
  for (const c of ca) statusMap.set(c.status, (statusMap.get(c.status) ?? 0) + 1);
  const STATUS_COLORS: Record<string, string> = { completed: "#22c55e", closed: "#22c55e", verified: "#10b981", open: "#ef4444", in_progress: "#f59e0b", review: "#3b82f6" };

  return {
    exec: {
      overallCompliance: overall, accreditationReadiness: overall, evidenceCount: ev.length,
      auditReadiness: overall, criticalFindings: nonCompliant + critical, docsDue: null, closureRate,
    },
    standards: {
      cards: { compliant, partial: null, nonCompliant, notAssessed, overall },
      byArea,
      distribution: [
        { label: "Compliant", n: compliant, color: "#22c55e" },
        { label: "Non-Compliant", n: nonCompliant, color: "#ef4444" },
        { label: "Not Assessed", n: notAssessed, color: "#cbd5e1" },
      ],
    },
    reports: { note: "No accreditation-report store exists yet. The report builder (draft→submission workflow, executive summaries, submission tracking) is on the roadmap." },
    evidence: {
      cards: { total: ev.length, valid: null, awaiting: null, expired: null, missing: null },
      byType: evByType,
      note: "The evidence table holds uploaded files; a standards-linked evidence repository with validity/expiry lifecycle isn't built yet.",
    },
    mapping: { note: "No regulatory-mapping store exists. Mapping requirements to programmes, curricula, competencies, CPUs and policies (with cross-framework comparison) is on the roadmap." },
    audit: {
      cards: { readinessScore: overall, openFindings: open, auditsRun: au.length, nextAudit: null },
      byDomain: byArea,
      note: "Readiness is derived from recorded audits. Mock-audit management, the audit calendar and evidence room need their stores.",
    },
    documents: { note: "No quality-document store exists (policies table is empty). Version control, approvals, publication and acknowledgements are on the roadmap." },
    improvement: {
      cards: { open, critical, overdue, completed, closureRate },
      bySource: [...srcMap.entries()].map(([label, n]) => ({ label, n })),
      status: [...statusMap.entries()].map(([label, n]) => ({ label: label.replace(/_/g, " "), n, color: STATUS_COLORS[label] ?? "#9ca3af" })),
      items: ca.slice(0, 8).map(c => ({ title: c.title, status: c.status, priority: c.priority ?? "—", due: c.due_date })),
    },
  };
}
