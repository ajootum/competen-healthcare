// OGS office resolver — the bridge between a workspace and its constituted Office (OGS R001 refactor).
// FAIL-SOFT by design: prefers the first-class ogs_offices model (migration 116/117) and, until that
// migration is applied, falls back to the v1 governance_committees mapping so every governed workspace
// still shows a real office identity. This is what lets the R001 governance banner light up immediately
// and upgrade automatically once the foundation migration runs.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/office-governance/_ui";

export type Appointment = { personId: string | null; personName: string | null; role: string; status: string; createdAt: string | null };
export type ResolvedOffice = {
  id: string;
  source: "ogs" | "committee";
  name: string;
  officeType: string;
  scopeType: string;
  status: string;
  active: boolean;
  authoritySource: string | null;
  reportingLine: string | null;
  chairId: string | null;
  chairName: string | null;
  quorum: number;
  memberCount: number;
  charterVersion: string | null;
  nextReview: string | null;
  establishedAt: string | null;
  appointments: Appointment[];
};

async function resolveNames(admin: any, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return map;
  const { data } = await admin.from("profiles").select("id, full_name").in("id", uniq.slice(0, 500));
  (data ?? []).forEach((p: any) => map.set(p.id, p.full_name));
  return map;
}

export async function resolveOffices(admin: any, hid: string | null, isSuper: boolean): Promise<{ source: "ogs" | "committee"; offices: ResolvedOffice[] }> {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Preferred path: first-class offices (migration 116/117).
  const ogsRes = await scope(admin.from("ogs_offices").select("id, name, office_type, scope_type, status, authority_source, reporting_line, chair_id, chair_name, quorum, next_review_date, established_at, charter_version, is_active").limit(3000));
  if (!ogsRes.error && (ogsRes.data?.length ?? 0) > 0) {
    const rows = ogsRes.data as any[];
    const ids = rows.map(o => o.id);
    let appts: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from("ogs_office_appointments").select("office_id, person_id, person_name, role, status, created_at").in("office_id", ids.slice(i, i + 200)).limit(20000);
      appts = appts.concat(data ?? []);
    }
    const nameMap = await resolveNames(admin, [...appts.filter(a => a.person_id && !a.person_name).map(a => a.person_id), ...rows.filter(o => o.chair_id && !o.chair_name).map(o => o.chair_id)]);
    const byOffice = new Map<string, any[]>();
    appts.forEach(a => { const arr = byOffice.get(a.office_id) ?? []; arr.push(a); byOffice.set(a.office_id, arr); });
    const offices: ResolvedOffice[] = rows.map(o => {
      const oa = (byOffice.get(o.id) ?? []).filter(a => a.status !== "removed" && a.status !== "expired");
      const chairAppt = oa.find(a => a.role === "chair");
      return {
        id: o.id, source: "ogs" as const, name: o.name, officeType: o.office_type ?? "governance", scopeType: o.scope_type ?? "hospital",
        status: o.status ?? "active", active: o.is_active !== false,
        authoritySource: o.authority_source ?? null, reportingLine: o.reporting_line ?? null,
        chairId: o.chair_id ?? chairAppt?.person_id ?? null,
        chairName: o.chair_name ?? (chairAppt ? (chairAppt.person_name ?? nameMap.get(chairAppt.person_id) ?? "Appointed") : null),
        quorum: o.quorum ?? 3, memberCount: oa.length, charterVersion: o.charter_version ?? null,
        nextReview: o.next_review_date ?? null, establishedAt: o.established_at ?? null,
        appointments: oa.map(a => ({ personId: a.person_id ?? null, personName: a.person_name ?? nameMap.get(a.person_id) ?? null, role: a.role, status: a.status, createdAt: a.created_at ?? null })),
      };
    });
    return { source: "ogs", offices };
  }

  // Fallback: v1 committee mapping (until the foundation migration is applied).
  const cRes = await scope(admin.from("governance_committees").select("id, name, level, quorum, is_active, created_at").limit(3000));
  if (cRes.error) return { source: "committee", offices: [] };
  const committees = (cRes.data ?? []) as any[];
  const ids = committees.map(c => c.id);
  let members: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    if (!ids.length) break;
    const { data } = await admin.from("committee_members").select("committee_id, profile_id, role, created_at").in("committee_id", ids.slice(i, i + 200)).limit(20000);
    members = members.concat(data ?? []);
  }
  const nameMap = await resolveNames(admin, members.map(m => m.profile_id));
  const byC = new Map<string, any[]>();
  members.forEach(m => { const arr = byC.get(m.committee_id) ?? []; arr.push(m); byC.set(m.committee_id, arr); });
  const offices: ResolvedOffice[] = committees.map(c => {
    const cm = byC.get(c.id) ?? [];
    const chair = cm.find(m => m.role === "chair");
    return {
      id: c.id, source: "committee" as const, name: c.name, officeType: "governance", scopeType: c.level ?? "hospital",
      status: c.is_active ? "active" : "suspended", active: !!c.is_active,
      authoritySource: "Governance committee", reportingLine: null,
      chairId: chair?.profile_id ?? null, chairName: chair ? (nameMap.get(chair.profile_id) ?? "Appointed") : null,
      quorum: c.quorum ?? 1, memberCount: cm.length, charterVersion: null,
      nextReview: null, establishedAt: c.created_at ? String(c.created_at).slice(0, 10) : null,
      appointments: cm.map(m => ({ personId: m.profile_id, personName: nameMap.get(m.profile_id) ?? null, role: m.role, status: "active", createdAt: m.created_at ?? null })),
    };
  });
  return { source: "committee", offices };
}

// Match a governed workspace to its Office. Returns the best real match, or a synthetic default identity
// (bound:false) so the banner always renders a meaningful office even before an office is constituted.
const MATCHERS: Record<string, { types: string[]; re: RegExp; defaultName: string; authority: string; icon: string }> = {
  competency: { types: ["competency"], re: /competen|framework|credential|nursing|clinical compet/i, defaultName: "Competency Office", authority: "Chief Nursing Officer", icon: "🎓" },
  quality: { types: ["quality"], re: /quality|accreditation|patient safety|\bsafety\b/i, defaultName: "Quality & Accreditation Office", authority: "Chief Quality Officer", icon: "✅" },
  executive: { types: ["executive"], re: /executive|board|leadership|clinical governance/i, defaultName: "Hospital Executive Office", authority: "Chief Executive Officer", icon: "🏛️" },
  hr: { types: ["hr"], re: /workforce|human resource|people|\bhr\b/i, defaultName: "HR Office", authority: "Chief People Officer", icon: "👥" },
};

// Management loader — reads the FIRST-CLASS office model directly (ids for office + appointments), for the
// write-workflow admin surface. Unlike resolveOffices it does NOT fall back to committees: the management
// UI acts on real ogs_* rows, so an unmigrated tenant gets provisioned:false (constitute-your-first-office).
export type AdminAppointment = { id: string; personId: string | null; personName: string | null; role: string };
export type AdminOffice = {
  id: string; name: string; officeType: string; scopeType: string; status: string;
  authoritySource: string | null; chairName: string | null; quorum: number; nextReview: string | null;
  charterVersion: string | null; establishedAt: string | null; memberCount: number; appointments: AdminAppointment[];
};

export async function loadOfficeAdmin(admin: any, hid: string | null, isSuper: boolean): Promise<{ provisioned: boolean; offices: AdminOffice[] }> {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const res = await scope(admin.from("ogs_offices").select("id, name, office_type, scope_type, status, authority_source, chair_name, quorum, next_review_date, charter_version, established_at").order("created_at", { ascending: true }).limit(2000));
  if (res.error) return { provisioned: false, offices: [] };
  const rows = (res.data ?? []) as any[];
  const ids = rows.map(o => o.id);
  let appts: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    if (!ids.length) break;
    const { data } = await admin.from("ogs_office_appointments").select("id, office_id, person_id, person_name, role, status").in("office_id", ids.slice(i, i + 200)).eq("status", "active").limit(20000);
    appts = appts.concat(data ?? []);
  }
  const byOffice = new Map<string, any[]>();
  appts.forEach(a => { const arr = byOffice.get(a.office_id) ?? []; arr.push(a); byOffice.set(a.office_id, arr); });
  const offices: AdminOffice[] = rows.map(o => {
    const oa = byOffice.get(o.id) ?? [];
    return { id: o.id, name: o.name, officeType: o.office_type ?? "governance", scopeType: o.scope_type ?? "hospital", status: o.status ?? "active", authoritySource: o.authority_source ?? null, chairName: o.chair_name ?? null, quorum: o.quorum ?? 3, nextReview: o.next_review_date ?? null, charterVersion: o.charter_version ?? null, establishedAt: o.established_at ?? null, memberCount: oa.length, appointments: oa.map(a => ({ id: a.id, personId: a.person_id ?? null, personName: a.person_name ?? null, role: a.role })) };
  });
  return { provisioned: true, offices };
}

export type WorkspaceOffice = ResolvedOffice & { bound: boolean; icon: string; viewerRole: string | null };

export async function officeForWorkspace(admin: any, key: keyof typeof MATCHERS, hid: string | null, isSuper: boolean, viewerId?: string | null): Promise<WorkspaceOffice> {
  const m = MATCHERS[key];
  const { source, offices } = await resolveOffices(admin, hid, isSuper);
  const office = offices.find(o => m.types.includes(o.officeType)) ?? offices.find(o => m.re.test(o.name)) ?? null;
  const resolved: ResolvedOffice = office ?? {
    id: "", source, name: m.defaultName, officeType: key, scopeType: isSuper ? "enterprise" : "hospital",
    status: "active", active: true, authoritySource: m.authority, reportingLine: null,
    chairId: null, chairName: null, quorum: 0, memberCount: 0, charterVersion: null,
    nextReview: null, establishedAt: null, appointments: [],
  };
  const viewer = viewerId ? resolved.appointments.find(a => a.personId === viewerId) ?? null : null;
  return { ...resolved, bound: !!office, icon: m.icon, viewerRole: viewer?.role ?? null };
}
