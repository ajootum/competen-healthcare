// Per-module loaders for the UMW Administration & Configuration section — each a lens over fetchAdmin. Read model.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchAdmin, pct, daysLeft } from "./admin-suite";

const group = (rows: any[], key: string) => rows.reduce((acc: Record<string, number>, r) => { const k = r[key] ?? "other"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const mean = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);

// ── ADM-001 Unit Administration Dashboard ──
export async function loadAdmDashboard(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchAdmin(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  const { documents, assets, config, changes, forms, delegations, aiRecs, profile, nameById, reused } = d;

  const pubDocs = documents.filter(x => x.status === "published");
  const configHealth = config.length ? pct(config.filter(c => ["active", "published"].includes(c.status)).length, config.length) : 0;
  const policyCompliance = pubDocs.length ? mean(pubDocs.map(x => Number(x.acknowledgement_pct || 0))) : 0;
  const assetReadiness = assets.length ? pct(assets.filter(a => a.status === "in_service").length, assets.length) : 0;
  const docCompleteness = documents.length ? pct(pubDocs.length, documents.length) : 0;
  const pendingApprovals = changes.filter(c => c.status === "pending_approval").length + documents.filter(x => x.status === "pending_approval").length + delegations.filter(x => x.status === "scheduled").length;
  const adminHealth = clamp((configHealth + policyCompliance + assetReadiness + docCompleteness) / 4);

  const kpis = {
    adminHealth, configHealth, policyCompliance, assetReadiness, docCompleteness,
    governanceCompliance: clamp(100 - changes.filter(c => c.risk === "high" && c.status !== "published").length * 4 - pendingApprovals * 2),
    pendingApprovals, auditReadiness: clamp(80 + (changes.filter(c => c.status === "published").length / Math.max(1, changes.length)) * 20),
    aiScore: aiRecs.length ? mean(aiRecs.map(r => Number(r.confidence || 0))) : 0,
  };

  // Administrative activity — recent changes + published docs, unified.
  const activity = [
    ...changes.slice(0, 8).map(c => ({ item: c.title, type: "Change", by: nameById.get(c.author_id) ?? "—", status: c.status, at: c.created_at })),
    ...pubDocs.slice(0, 4).map(x => ({ item: x.title, type: "Document", by: nameById.get(x.owner_id) ?? "—", status: x.status, at: x.created_at })),
  ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()).slice(0, 8);

  // Tasks & approvals queue.
  const tasks = [
    ...changes.filter(c => c.status === "pending_approval").slice(0, 3).map(c => ({ title: `Approve: ${c.title}`, type: "Change", priority: c.risk === "high" ? "High" : "Medium" })),
    ...documents.filter(x => x.status === "in_review").slice(0, 3).map(x => ({ title: `Review: ${x.title}`, type: "Document", priority: "Medium" })),
    ...delegations.filter(x => x.status === "scheduled").slice(0, 2).map(x => ({ title: `Delegation: ${x.position}`, type: "Governance", priority: "Low" })),
  ].slice(0, 6);

  const modules = [
    { name: "Unit Structure & Organization", href: "/unit-manager/administration/structure", stat: `${reused.departments.length} depts · ${reused.bedTotal} beds`, icon: "🏛️" },
    { name: "Policies, SOPs & Documents", href: "/unit-manager/administration/documents", stat: `${documents.length} docs · ${documents.filter(x => x.status === "in_review").length} in review`, icon: "📄" },
    { name: "Resource & Asset Admin", href: "/unit-manager/administration/assets", stat: `${assets.length} assets · ${assets.filter(a => a.status === "under_maintenance").length} maint.`, icon: "🖥️" },
    { name: "Forms & Registers", href: "/unit-manager/administration/forms", stat: `${forms.length} forms`, icon: "📋" },
    { name: "Configuration Centre", href: "/unit-manager/administration/configuration", stat: `${config.length} items · ${config.filter(c => c.status === "published").length} published`, icon: "🔧" },
    { name: "Permissions & Governance", href: "/unit-manager/administration/governance", stat: `${delegations.filter(x => x.status === "active").length} delegations`, icon: "🛡️" },
    { name: "Audit & Change Management", href: "/unit-manager/administration/change", stat: `${changes.length} changes`, icon: "🕓" },
    { name: "AI Administration Assistant", href: "/unit-manager/administration/ai-assistant", stat: `${aiRecs.length} recommendations`, icon: "🤖" },
  ];

  return {
    provisioned: true as const, hasData: d.hasData, kpis, activity, tasks, modules,
    profile, aiRecs: aiRecs.slice(0, 4),
    docsSnapshot: { active: documents.filter(x => x.status === "published").length, draft: documents.filter(x => x.status === "draft").length, review: documents.filter(x => x.status === "in_review").length, expiring: documents.filter(x => { const dl = daysLeft(x.review_date); return dl != null && dl >= 0 && dl <= 30; }).length },
    assetSnapshot: { total: assets.length, inService: assets.filter(a => a.status === "in_service").length, maint: assets.filter(a => a.status === "under_maintenance").length, out: assets.filter(a => a.status === "out_of_service").length, calDue: assets.filter(a => { const dl = daysLeft(a.calibration_due); return dl != null && dl >= 0 && dl <= 30; }).length },
    configHealthBreakdown: [
      { label: "Policy currency", pct: policyCompliance }, { label: "Configuration completeness", pct: configHealth },
      { label: "Asset registry quality", pct: assetReadiness }, { label: "Documentation status", pct: docCompleteness },
      { label: "Governance compliance", pct: kpis.governanceCompliance }, { label: "Publication status", pct: config.length ? pct(config.filter(c => c.status === "published").length, config.length) : 0 },
    ],
  };
}

// ── ADM-002 Unit Structure & Organization ──
export async function loadAdmStructure(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchAdmin(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  const { profile, rooms, services, rules, reused, nameById } = d;
  const bedTypes = group(reused.beds, "bed_type");
  return {
    provisioned: true as const, hasData: d.hasData,
    profile: profile ? { ...profile, managerName: nameById.get(profile.manager_id) ?? "—" } : null,
    kpis: { units: 1, departments: reused.departments.length, rooms: rooms.length, beds: reused.bedTotal, services: services.filter(s => s.status === "active").length, costCentres: profile?.cost_centre ? 1 : 0, establishment: reused.positionTotal, structureHealth: clamp(80 + (reused.bedTotal ? 12 : 0)) },
    rooms, services, rules,
    beds: { total: reused.bedTotal, occupied: reused.bedOccupied, available: reused.beds.filter(b => b.status === "available").length, maintenance: reused.beds.filter(b => b.status === "out_of_service").length, byType: Object.entries(bedTypes).map(([type, n]) => ({ type, n })) },
    establishment: { total: reused.positionTotal, filled: reused.positionFilled, vacant: reused.positionTotal - reused.positionFilled, pct: reused.positionTotal ? pct(reused.positionFilled, reused.positionTotal) : 0 },
    departments: reused.departments,
  };
}

// ── ADM-003 Policies, SOPs & Documents ──
export async function loadAdmDocuments(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchAdmin(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  const docs = d.documents.map(x => ({ ...x, ownerName: d.nameById.get(x.owner_id) ?? "—", reviewIn: daysLeft(x.review_date) }));
  const TYPES = [["policy", "Policies"], ["sop", "SOPs"], ["guideline", "Guidelines"], ["protocol", "Protocols"], ["form", "Forms"], ["work_instruction", "Work Instructions"]];
  const STATUSES = ["published", "in_review", "draft", "pending_approval", "archived"];
  const pub = docs.filter(x => x.status === "published");
  return {
    provisioned: true as const, hasData: docs.length > 0,
    kpis: {
      total: docs.length, published: pub.length,
      awaitingReview: docs.filter(x => ["in_review", "pending_approval"].includes(x.status)).length,
      ackRate: pub.length ? mean(pub.map(x => Number(x.acknowledgement_pct || 0))) : 0,
      expiring: docs.filter(x => x.reviewIn != null && x.reviewIn >= 0 && x.reviewIn <= 30).length,
      governanceScore: clamp((docs.length ? pct(pub.length, docs.length) : 0) * 0.5 + (pub.length ? mean(pub.map(x => Number(x.acknowledgement_pct || 0))) : 0) * 0.5),
    },
    byType: TYPES.map(([k, label]) => ({ label, n: docs.filter(x => x.doc_type === k).length })).filter(x => x.n > 0),
    byStatus: STATUSES.map(s => ({ status: s, n: docs.filter(x => x.status === s).length })).filter(x => x.n > 0),
    byCategory: Object.entries(group(docs, "category")).map(([category, n]) => ({ category, n })).sort((a, b) => (b.n as number) - (a.n as number)),
    regulatory: Object.entries(group(docs, "regulatory")).map(([reg, n]) => ({ reg, n, coverage: pct(docs.filter(x => x.regulatory === reg && x.status === "published").length, Math.max(1, n as number)) })),
    reviewDue: docs.filter(x => x.reviewIn != null && x.reviewIn >= -5 && x.reviewIn <= 45).sort((a, b) => (a.reviewIn ?? 0) - (b.reviewIn ?? 0)).slice(0, 8),
    pending: docs.filter(x => ["in_review", "pending_approval"].includes(x.status)).slice(0, 6),
    recent: [...pub].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 6),
  };
}

// ── ADM-004 Resource & Asset Administration ──
export async function loadAdmAssets(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchAdmin(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  const assets = d.assets.map(a => ({ ...a, custodianName: d.nameById.get(a.custodian_id) ?? "—", maintIn: daysLeft(a.maintenance_due), calIn: daysLeft(a.calibration_due), warrantyIn: daysLeft(a.warranty_expiry) }));
  const CATS = [["clinical", "Clinical Equipment"], ["it", "IT & Communication"], ["furniture", "Furniture & Fixtures"], ["infrastructure", "Infrastructure"], ["emergency", "Emergency Equipment"], ["other", "Other Assets"]];
  const STATUSES = [["in_service", "In Service"], ["under_maintenance", "Under Maintenance"], ["out_of_service", "Out of Service"], ["in_storage", "In Storage"], ["pending", "Pending Deployment"]];
  const inSvc = assets.filter(a => a.status === "in_service").length;
  return {
    provisioned: true as const, hasData: assets.length > 0,
    kpis: {
      total: assets.length, readiness: assets.length ? pct(inSvc, assets.length) : 0,
      availability: assets.length ? pct(inSvc + assets.filter(a => a.status === "in_storage").length, assets.length) : 0,
      maintDue: assets.filter(a => a.maintIn != null && a.maintIn >= -5 && a.maintIn <= 30).length,
      calDue: assets.filter(a => a.calIn != null && a.calIn >= -5 && a.calIn <= 30).length,
      down: assets.filter(a => ["under_maintenance", "out_of_service"].includes(a.status)).length,
      utilisation: assets.length ? mean(assets.map(a => Number(a.utilisation_pct || 0))) : 0,
      warrantyCovered: assets.length ? pct(assets.filter(a => a.warrantyIn != null && a.warrantyIn > 0).length, assets.length) : 0,
    },
    byCategory: CATS.map(([k, label]) => ({ label, n: assets.filter(a => a.category === k).length })).filter(x => x.n > 0),
    byStatus: STATUSES.map(([k, label]) => ({ label, status: k, n: assets.filter(a => a.status === k).length })).filter(x => x.n > 0),
    maintenanceDue: assets.filter(a => a.maintIn != null && a.maintIn <= 30).sort((a, b) => (a.maintIn ?? 0) - (b.maintIn ?? 0)).slice(0, 6),
    calibrationDue: assets.filter(a => a.calIn != null && a.calIn <= 30).sort((a, b) => (a.calIn ?? 0) - (b.calIn ?? 0)).slice(0, 6),
    atRisk: assets.filter(a => Number(a.utilisation_pct || 0) < 25 || (a.warrantyIn != null && a.warrantyIn < 30)).slice(0, 5),
    vendors: Object.entries(group(assets, "vendor")).map(([vendor, n]) => ({ vendor, n })).sort((a, b) => (b.n as number) - (a.n as number)).slice(0, 5),
  };
}

// ── ADM-005 Forms, Registers & Documentation ──
export async function loadAdmForms(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchAdmin(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  const forms = d.forms.map(f => ({ ...f, reviewIn: daysLeft(f.review_date) }));
  const TYPES = [["form", "Forms"], ["register", "Registers"], ["checklist", "Checklists"], ["log", "Logs"]];
  return {
    provisioned: true as const, hasData: forms.length > 0,
    kpis: {
      total: forms.length, active: forms.filter(f => ["active", "published"].includes(f.status)).length,
      submissions: forms.reduce((a, f) => a + Number(f.submissions || 0), 0),
      compliance: forms.length ? mean(forms.map(f => Number(f.compliance_pct || 0))) : 0,
      pendingReview: forms.filter(f => f.reviewIn != null && f.reviewIn >= 0 && f.reviewIn <= 30).length,
    },
    byType: TYPES.map(([k, label]) => ({ label, n: forms.filter(f => f.form_type === k).length })).filter(x => x.n > 0),
    forms: [...forms].sort((a, b) => Number(b.submissions) - Number(a.submissions)),
  };
}

// ── ADM-006 Unit Configuration & Customization ──
export async function loadAdmConfig(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchAdmin(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  const cfg = d.config;
  const TYPES = [["workspace", "Workspace"], ["dashboard", "Dashboards"], ["workflow", "Workflows"], ["terminology", "Terminology"], ["notification", "Notifications"], ["integration", "Integrations"], ["branding", "Branding"]];
  const workflows = cfg.filter(c => c.config_type === "workflow");
  return {
    provisioned: true as const, hasData: cfg.length > 0,
    kpis: {
      total: cfg.length, active: cfg.filter(c => c.status === "active").length,
      pending: cfg.filter(c => c.status === "in_review").length, published: cfg.filter(c => c.status === "published").length,
      inherited: cfg.filter(c => c.source === "inherited").length, local: cfg.filter(c => c.source === "local").length,
      health: cfg.length ? pct(cfg.filter(c => ["active", "published"].includes(c.status)).length, cfg.length) : 0,
    },
    byType: TYPES.map(([k, label]) => ({ label, type: k, n: cfg.filter(c => c.config_type === k).length })).filter(x => x.n > 0),
    workflows: [...workflows].sort((a, b) => Number(b.runs) - Number(a.runs)).map(w => ({ name: w.name, status: w.status, runs: w.runs })),
    integrations: cfg.filter(c => c.config_type === "integration").map(i => ({ name: i.name, status: i.status })),
    terminology: cfg.filter(c => c.config_type === "terminology").map(t => ({ name: t.name })),
    recent: [...cfg].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 6),
  };
}

// ── ADM-007 Permissions, Delegation & Governance ──
export async function loadAdmGovernance(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchAdmin(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  const { delegations, changes, reused, nameById } = d;
  const deleg = delegations.map(x => ({ ...x, delegateName: nameById.get(x.delegate_id) ?? "—", byName: nameById.get(x.delegated_by) ?? "—" }));
  const pendingApprovals = changes.filter(c => c.status === "pending_approval");
  const active = deleg.filter(x => x.status === "active");
  return {
    provisioned: true as const, hasData: deleg.length > 0 || reused.totalUsers > 0,
    kpis: {
      roles: Object.keys(reused.roleDist).length, activeDelegations: active.length,
      pendingApprovals: pendingApprovals.length, emergencyAccess: reused.emergencyAccess.length,
      users: reused.totalUsers, sodCompliance: 96,
      governanceScore: clamp(96 - pendingApprovals.length * 2),
    },
    roleDist: Object.entries(reused.roleDist).map(([role, n]) => ({ role: String(role).replace(/_/g, " "), n })).sort((a, b) => (b.n as number) - (a.n as number)),
    delegations: deleg,
    approvals: pendingApprovals.slice(0, 6).map(c => ({ title: c.title, by: nameById.get(c.author_id) ?? "—", priority: c.risk === "high" ? "High" : c.risk === "medium" ? "Medium" : "Low", approver: c.approver })),
    emergency: reused.emergencyAccess.slice(0, 5),
    policies: [
      { name: "Segregation of Duties Policy", compliance: 98 }, { name: "Delegation Policy", compliance: 95 },
      { name: "Approval Authority Policy", compliance: 94 }, { name: "Emergency Access Policy", compliance: 100 },
      { name: "Access Review Policy", compliance: 92 },
    ],
  };
}

// ── ADM-008 Audit, Versioning & Change Management ──
export async function loadAdmChange(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchAdmin(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  const changes = d.changes.map(c => ({ ...c, authorName: d.nameById.get(c.author_id) ?? "—" }));
  const STATUSES = [["draft", "Draft"], ["in_review", "In Review"], ["pending_approval", "Pending Approval"], ["approved", "Approved"], ["published", "Published"], ["rolled_back", "Rolled Back"], ["cancelled", "Cancelled"]];
  const TYPES = ["config", "workflow", "dashboard", "policy", "permission", "form", "asset", "rule", "ai"];
  const published = changes.filter(c => c.status === "published");
  return {
    provisioned: true as const, hasData: changes.length > 0,
    kpis: {
      total: changes.length, pendingReviews: changes.filter(c => ["in_review", "pending_approval"].includes(c.status)).length,
      deployments: published.length, rollbacks: changes.filter(c => c.status === "rolled_back").length,
      highRisk: changes.filter(c => c.risk === "high").length, exceptions: changes.filter(c => c.status === "rolled_back" || c.status === "cancelled").length,
      auditHealth: clamp(92 - changes.filter(c => c.status === "rolled_back").length * 3),
      approvalCompliance: changes.length ? pct(published.length + changes.filter(c => c.status === "approved").length, changes.length) : 0,
    },
    byStatus: STATUSES.map(([k, label]) => ({ label, status: k, n: changes.filter(c => c.status === k).length })).filter(x => x.n > 0),
    byType: TYPES.map(t => ({ type: t, n: changes.filter(c => c.change_type === t).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n),
    recent: changes.slice(0, 8),
    pending: changes.filter(c => c.status === "pending_approval").slice(0, 6),
    impact: { affectedUsers: changes.reduce((a, c) => a + Number(c.affected_users || 0), 0), highImpact: changes.filter(c => Number(c.affected_users) > 100).length },
  };
}

// ── ADM-009 AI Administration Assistant ──
export async function loadAdmAi(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchAdmin(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  const { aiRecs, automations } = d;
  return {
    provisioned: true as const, hasData: aiRecs.length > 0 || automations.length > 0,
    kpis: {
      recommendations: aiRecs.length, highImpact: aiRecs.filter(r => r.impact === "high").length,
      avgConfidence: aiRecs.length ? mean(aiRecs.map(r => Number(r.confidence || 0))) : 0,
      activeAutomations: automations.filter(a => a.status === "active").length,
      totalRuns: automations.reduce((a, x) => a + Number(x.runs || 0), 0),
      acceptanceRate: 78,
    },
    recommendations: aiRecs.map(r => ({ title: r.title, detail: r.detail, category: r.category, confidence: r.confidence, impact: r.impact })),
    automations: [...automations].sort((a, b) => Number(b.runs) - Number(a.runs)),
    prompts: ["Show me all pending approvals", "Generate this month's governance report", "What changed in my unit this week?", "Identify governance risks", "Which equipment needs maintenance?", "Prepare unit for JCI survey"],
  };
}
