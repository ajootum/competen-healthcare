import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Professional Development ─────────────────────────────────────────────────
// The educator career-growth, capability, credentialing and portfolio centre
// (Professional Development spec + developer spec + mockup). A landing hub with
// eight development modules, each opening a module page.
//
// Honest-UI: the educator's OWN records drive everything that is live — CPD
// (cpd_logs), credentials & recognitions & authorisations (professional_*),
// learning (course_enrollments + courses + learning_pathways) and competency
// scores (competency_scores via their cycles). Development-plan goals,
// mentorship, reflective portfolio and appraisal have no store yet, so those
// KPIs are muted and the modules render honest scaffolds — never fabricated.

export type DevModule = {
  slug: string; title: string; icon: string; tint: string; blurb: string; bullets: string[];
  live: boolean;
};

export const DEV_MODULES: DevModule[] = [
  { slug: "competency-profile", title: "Educator Competency Profile", icon: "🧑‍🏫", tint: "text-blue-600 bg-blue-100",
    blurb: "Assess your capabilities against the educator competency framework.",
    bullets: ["Self-assessment", "Manager & peer validation", "Capability gaps", "Competency trends"], live: true },
  { slug: "development-plan", title: "Individual Development Plan", icon: "🎯", tint: "text-emerald-600 bg-emerald-100",
    blurb: "Set goals, plan activities and track your development progress.",
    bullets: ["Development goals", "Milestones", "Progress updates", "Supervisor review"], live: false },
  { slug: "learning-pathways", title: "Learning Pathways & Opportunities", icon: "📖", tint: "text-violet-600 bg-violet-100",
    blurb: "Discover and enrol in learning pathways and development opportunities.",
    bullets: ["Recommended pathways", "Courses & workshops", "Enrolment & progress", "Communities of practice"], live: true },
  { slug: "cpd", title: "CPD & Learning Activity Tracker", icon: "⏱️", tint: "text-amber-600 bg-amber-100",
    blurb: "Record and manage your continuing professional development activities.",
    bullets: ["Log CPD activity", "Automatic hours", "Evidence & reflection", "CPD statements"], live: true },
  { slug: "credentials", title: "Credentials, Certifications & Licensure", icon: "🏅", tint: "text-rose-600 bg-rose-100",
    blurb: "Manage your professional credentials, certifications and licensure.",
    bullets: ["Credential lifecycle", "Renewal reminders", "Verification", "Mandatory certifications"], live: true },
  { slug: "mentorship", title: "Mentorship, Coaching & Peer Development", icon: "🤝", tint: "text-teal-600 bg-teal-100",
    blurb: "Connect with mentors, record sessions and grow through collaboration.",
    bullets: ["Find a mentor", "Session notes", "Milestones", "Peer observation"], live: false },
  { slug: "portfolio", title: "Reflective Practice & Professional Portfolio", icon: "📁", tint: "text-indigo-600 bg-indigo-100",
    blurb: "Build your portfolio and reflect on your professional practice.",
    bullets: ["Reflections", "Evidence collections", "Portfolio builder", "Export as PDF"], live: false },
  { slug: "appraisal", title: "Appraisal, Progression & Career Development", icon: "📈", tint: "text-cyan-600 bg-cyan-100",
    blurb: "Prepare for reviews, track progression and plan your career path.",
    bullets: ["Review preparation", "Evidence aggregation", "Readiness gaps", "Career pathways"], live: false },
];

export type Kpi = { label: string; value: number | string | null; sub: string; icon: string; tint: string; muted?: boolean; pct?: number };
export type Activity = { icon: string; text: string; when: string | null };
export type Deadline = { title: string; date: string | null; tone: string; sub: string };
export type Domain = { id: string; name: string; achieved: number; total: number; level: string };
export type Priority = { area: string; current: string; gap: string };
export type Pair = { label: string; value: string; muted?: boolean };

export type CpdRow = { id: string; title: string; type: string; date: string | null; hours: number; verified: boolean };
export type CredRow = { id: string; title: string; issuer: string; number: string | null; status: string; expiry: string | null; verified: boolean; kind: string };
export type CourseRow = { id: string; title: string; category: string; progress: number; enrolled: string | null; completed: boolean };
export type DomainScore = { name: string; level: string; passing: boolean };

type Row = Record<string, unknown>;

const DAY = 864e5;
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const daysUntil = (iso: string | null) => iso ? Math.round((new Date(iso).getTime() - Date.now()) / DAY) : null;
const aiOn = () => import("@/lib/ai/config").then(m => m.aiStatus().configured).catch(() => false);

// Shared per-educator fetch used by both the hub and the modules.
async function fetchEducatorData(admin: Admin, userId: string, hospitalId: string) {
  const [cpdRes, credRes, recRes, authRes, enrollRes, cycleRes, hospRes] = await Promise.all([
    admin.from("cpd_logs").select("id, title, activity_type, hours, activity_date, verified, created_at").eq("user_id", userId).order("activity_date", { ascending: false }).limit(200),
    admin.from("professional_credentials").select("id, title, issuing_body, credential_number, credential_type, status, expiry_date, verified").eq("nurse_id", userId).order("expiry_date", { ascending: true }).limit(100),
    admin.from("professional_recognitions").select("id, title, recognition_type, awarded_by_name, awarded_at").eq("nurse_id", userId).order("awarded_at", { ascending: false }).limit(50),
    admin.from("clinical_authorizations").select("id, authorization_type, authorization_level, status, expiry_date").eq("nurse_id", userId).order("expiry_date", { ascending: true }).limit(50),
    admin.from("course_enrollments").select("id, course_id, progress, completed_at, enrolled_at, courses(title, category)").eq("user_id", userId).order("enrolled_at", { ascending: false }).limit(100),
    admin.from("competency_cycles").select("id").eq("nurse_id", userId).limit(50),
    hospitalId ? admin.from("hospitals").select("cpd_target_hours").eq("id", hospitalId).limit(1) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const cpd = (cpdRes.data ?? []) as Row[];
  const creds = (credRes.data ?? []) as Row[];
  const recs = (recRes.data ?? []) as Row[];
  const auths = (authRes.data ?? []) as Row[];
  const enrolls = (enrollRes.data ?? []) as Row[];
  const cycleIds = ((cycleRes.data ?? []) as { id: string }[]).map(c => c.id);
  // Null when the org hasn't configured a target — never fabricate a denominator.
  const target = ((hospRes.data ?? [])[0] as { cpd_target_hours?: number } | undefined)?.cpd_target_hours ?? null;

  let scores: Row[] = [];
  if (cycleIds.length) {
    // `label`/`is_passing` are the live-populated columns (legacy level_label is
    // NULL). Newest-first, then dedupe by competency so a competency assessed in
    // several cycles isn't counted more than once.
    const { data } = await admin.from("competency_scores").select("competency_id, domain_id, label, is_passing, created_at").in("cycle_id", cycleIds).order("created_at", { ascending: false }).limit(500);
    const seen = new Set<string>();
    scores = ((data ?? []) as Row[]).filter(r => { const k = String(r.competency_id); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  return { cpd, creds, recs, auths, enrolls, scores, target };
}

const cpdHoursOf = (cpd: Row[]) => cpd.reduce((s, r) => s + (typeof r.hours === "number" ? r.hours : 0), 0);
const credExpiring = (creds: Row[]) => creds.filter(c => { const d = daysUntil(c.expiry_date as string ?? null); return d !== null && d >= 0 && d <= 90; }).length;
const credExpired = (creds: Row[]) => creds.filter(c => { const d = daysUntil(c.expiry_date as string ?? null); return d !== null && d < 0; }).length;

// ── Hub landing ──────────────────────────────────────────────────────────────
export type DevHub = {
  kpis: Kpi[]; domains: Domain[]; priorities: Priority[]; deadlines: Deadline[]; activity: Activity[];
  modules: DevModule[]; aiConfigured: boolean; hasCompetencyData: boolean;
};

export async function loadDevHub(admin: Admin, userId: string, hospitalId: string): Promise<DevHub> {
  const [{ cpd, creds, enrolls, scores, target }, domainNames, configured] = await Promise.all([
    fetchEducatorData(admin, userId, hospitalId),
    admin.from("framework_domains").select("id, name").limit(500).then(r => new Map(((r.data ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name]))),
    aiOn(),
  ]);

  const hours = cpdHoursOf(cpd);
  const pct = target ? Math.min(100, Math.round((hours / target) * 100)) : undefined;
  const passing = scores.filter(s => s.is_passing).length;
  const inProgress = enrolls.filter(e => !e.completed_at && (typeof e.progress !== "number" || e.progress < 100)).length;
  const expiring = credExpiring(creds);
  const expired = credExpired(creds);

  const kpis: Kpi[] = [
    { label: "CPD Progress", value: target ? `${hours} / ${target} hrs` : `${hours} hrs`, sub: target ? `${pct}% of target` : "no CPD target set", icon: "⏱️", tint: "text-emerald-600 bg-emerald-100", pct },
    { label: "Competency Status", value: scores.length ? `${passing} / ${scores.length}` : null, sub: scores.length ? "competencies achieved" : "no competency records yet", icon: "🧩", tint: "text-blue-600 bg-blue-100", muted: !scores.length },
    { label: "Development Goals", value: null, sub: "goals store not built yet", icon: "🎯", tint: "text-amber-600 bg-amber-100", muted: true },
    { label: "Credentials", value: creds.length, sub: expired ? `${expired} expired` : expiring ? `${expiring} expiring soon` : "all current", icon: "🏅", tint: "text-rose-600 bg-rose-100" },
    { label: "Learning Pathways", value: inProgress, sub: inProgress ? "in progress" : "none in progress", icon: "📖", tint: "text-violet-600 bg-violet-100" },
    { label: "Mentorship", value: null, sub: "mentorship store not built yet", icon: "🤝", tint: "text-teal-600 bg-teal-100", muted: true },
    { label: "Portfolio Readiness", value: null, sub: "portfolio store not built yet", icon: "📁", tint: "text-indigo-600 bg-indigo-100", muted: true },
  ];

  // Competency domains from real scores (grouped), names resolved where possible.
  const domainMap = new Map<string, { pass: number; total: number; levels: string[] }>();
  for (const s of scores) {
    const key = String(s.domain_id ?? "—");
    const d = domainMap.get(key) ?? { pass: 0, total: 0, levels: [] };
    d.total++; if (s.is_passing) d.pass++; if (s.label) d.levels.push(String(s.label));
    domainMap.set(key, d);
  }
  const domains: Domain[] = [...domainMap.entries()].map(([id, d]) => ({
    id, name: domainNames.get(id) ?? "Competency domain", achieved: d.pass, total: d.total,
    level: d.levels[0] ? titleCase(d.levels[0]) : "—",
  }));

  const priorities: Priority[] = scores.filter(s => !s.is_passing).slice(0, 5).map(s => ({
    area: domainNames.get(String(s.domain_id)) ?? "Competency", current: s.label ? titleCase(String(s.label)) : "Developing", gap: "below passing",
  }));

  // Deadlines from real credential expiries (+ CPD target).
  const deadlines: Deadline[] = creds
    .filter(c => c.expiry_date)
    .map(c => { const dleft = daysUntil(c.expiry_date as string)!; return { title: `${c.title} renewal`, date: c.expiry_date as string, sub: dleft < 0 ? "expired" : `${dleft} days remaining`, tone: dleft < 0 ? "text-rose-600" : dleft <= 30 ? "text-amber-600" : "text-gray-500" }; })
    .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 4);
  if (target && hours < target) deadlines.push({ title: `CPD requirement (${target} hrs)`, date: null, sub: `${hours} / ${target} hrs completed`, tone: "text-gray-500" });

  const activity: Activity[] = [
    ...cpd.slice(0, 3).map(c => ({ icon: "⏱️", text: `Logged CPD: ${c.title}`, when: (c.activity_date ?? c.created_at) as string })),
    ...creds.slice(0, 2).map(c => ({ icon: "🏅", text: `Credential: ${c.title}`, when: null })),
  ].slice(0, 5);

  return { kpis, domains, priorities, deadlines, activity, modules: DEV_MODULES, aiConfigured: configured, hasCompetencyData: scores.length > 0 };
}

// ── Module page ──────────────────────────────────────────────────────────────
export type DevModuleData = {
  module: DevModule; summary: Pair[]; cpd?: CpdRow[]; credentials?: CredRow[]; courses?: CourseRow[]; domainScores?: DomainScore[];
  groups: { title: string; items: string[] }[]; deadlines: Deadline[]; aiConfigured: boolean;
};

const MODULE_GROUPS: Record<string, { title: string; items: string[] }[]> = {
  "development-plan": [
    { title: "Goal structure", items: ["Goal title", "Development need", "Related competency", "Expected outcome", "Evidence required", "Mentor / supervisor", "Target date", "Priority"] },
    { title: "Goal statuses", items: ["Proposed", "Awaiting approval", "Active", "At risk", "Completed", "Deferred"] },
  ],
  mentorship: [
    { title: "Mentorship models", items: ["New educator mentorship", "Clinical educator mentorship", "Assessment mentorship", "Leadership coaching", "Peer observation", "Research mentorship", "Career mentorship"] },
    { title: "Mentorship plan", items: ["Development objectives", "Meeting frequency", "Agreed activities", "Milestones", "Evidence requirements", "Review dates"] },
  ],
  portfolio: [
    { title: "Portfolio categories", items: ["Teaching philosophy", "Teaching evidence", "Assessment contributions", "Learner feedback", "Quality-improvement work", "Leadership contributions", "Research & publications", "Reflective practice"] },
    { title: "Reflection structure", items: ["What happened?", "What was my role?", "What went well?", "What was challenging?", "What did I learn?", "What will I change?", "Which competency does this address?"] },
  ],
  appraisal: [
    { title: "Review types", items: ["Probation review", "Annual appraisal", "Competency review", "Promotion review", "Role-readiness review", "Leadership-readiness review", "Development-plan review"] },
    { title: "Career pathways", items: ["Associate Educator", "Educator", "Senior Educator", "Lead Educator", "Education Specialist", "Education Program Lead", "Education Manager", "Education Director"] },
  ],
};

export async function loadDevModule(admin: Admin, userId: string, hospitalId: string, slug: string): Promise<DevModuleData | null> {
  const mod = DEV_MODULES.find(m => m.slug === slug);
  if (!mod) return null;
  const [data, domainNames, configured] = await Promise.all([
    fetchEducatorData(admin, userId, hospitalId),
    admin.from("framework_domains").select("id, name").limit(500).then(r => new Map(((r.data ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name]))),
    aiOn(),
  ]);
  const { cpd, creds, recs, auths, enrolls, scores, target } = data;

  const summary: Pair[] = [];
  let cpdRows: CpdRow[] | undefined;
  let credentials: CredRow[] | undefined;
  let courses: CourseRow[] | undefined;
  let domainScores: DomainScore[] | undefined;

  if (slug === "cpd") {
    const hours = cpdHoursOf(cpd);
    summary.push(
      { label: "CPD hours", value: target ? `${hours} / ${target}` : `${hours}` },
      { label: "Activities logged", value: String(cpd.length) },
      { label: "Verified", value: String(cpd.filter(c => c.verified).length) },
    );
    cpdRows = cpd.map(c => ({ id: String(c.id), title: String(c.title ?? "Activity"), type: c.activity_type ? titleCase(String(c.activity_type)) : "—", date: (c.activity_date as string) ?? null, hours: typeof c.hours === "number" ? c.hours : 0, verified: !!c.verified }));
  } else if (slug === "credentials") {
    const expiring = credExpiring(creds), expired = credExpired(creds);
    summary.push(
      { label: "Credentials", value: String(creds.length) },
      { label: "Expiring soon", value: String(expiring) },
      { label: "Expired", value: String(expired) },
      { label: "Recognitions & authorisations", value: String(recs.length + auths.length) },
    );
    credentials = [
      ...creds.map(c => ({ id: String(c.id), title: String(c.title ?? "Credential"), issuer: String(c.issuing_body ?? "—"), number: (c.credential_number as string) ?? null, status: c.status ? titleCase(String(c.status)) : "—", expiry: (c.expiry_date as string) ?? null, verified: !!c.verified, kind: c.credential_type ? titleCase(String(c.credential_type)) : "Credential" })),
      ...auths.map(a => ({ id: String(a.id), title: `${titleCase(String(a.authorization_type ?? "Authorisation"))}`, issuer: "Clinical authorisation", number: null, status: a.status ? titleCase(String(a.status)) : "—", expiry: (a.expiry_date as string) ?? null, verified: true, kind: "Authorisation" })),
      ...recs.map(r => ({ id: String(r.id), title: String(r.title ?? "Recognition"), issuer: String(r.awarded_by_name ?? "—"), number: null, status: "Awarded", expiry: null, verified: true, kind: r.recognition_type ? titleCase(String(r.recognition_type)) : "Recognition" })),
    ];
  } else if (slug === "learning-pathways") {
    const done = enrolls.filter(e => e.completed_at).length;
    summary.push(
      { label: "Enrolments", value: String(enrolls.length) },
      { label: "Completed", value: String(done) },
      { label: "In progress", value: String(enrolls.length - done) },
    );
    courses = enrolls.map(e => {
      const c = e.courses as { title?: string; category?: string } | null;
      return { id: String(e.id), title: c?.title ?? "Course", category: c?.category ? titleCase(c.category) : "—", progress: typeof e.progress === "number" ? e.progress : 0, enrolled: (e.enrolled_at as string) ?? null, completed: !!e.completed_at };
    });
  } else if (slug === "competency-profile") {
    const passing = scores.filter(s => s.is_passing).length;
    summary.push(
      { label: "Competencies assessed", value: String(scores.length) },
      { label: "Achieved (passing)", value: String(passing) },
      { label: "Gaps", value: String(scores.length - passing) },
    );
    domainScores = scores.slice(0, 40).map(s => ({ name: domainNames.get(String(s.domain_id)) ?? "Competency", level: s.label ? titleCase(String(s.label)) : "—", passing: !!s.is_passing }));
    if (!scores.length) summary.push({ label: "Status", value: "no competency records for your account yet", muted: true });
  } else if (slug === "portfolio") {
    summary.push(
      { label: "CPD evidence", value: String(cpd.length) },
      { label: "Credentials", value: String(creds.length) },
      { label: "Completed learning", value: String(enrolls.filter(e => e.completed_at).length) },
      { label: "Reflections store", value: "not built yet", muted: true },
    );
  } else if (slug === "appraisal") {
    summary.push(
      { label: "CPD hours", value: target ? `${cpdHoursOf(cpd)} / ${target}` : `${cpdHoursOf(cpd)}` },
      { label: "Competencies passing", value: scores.length ? `${scores.filter(s => s.is_passing).length} / ${scores.length}` : "—", muted: !scores.length },
      { label: "Valid credentials", value: String(creds.filter(c => { const d = daysUntil(c.expiry_date as string ?? null); const bad = ["suspended", "revoked", "expired"].includes(String(c.status ?? "").toLowerCase()); return !bad && (d === null || d >= 0); }).length) },
      { label: "Appraisal store", value: "not built yet", muted: true },
    );
  } else {
    summary.push({ label: "Backing store", value: "not provisioned yet", muted: true });
  }

  const deadlines: Deadline[] = creds.filter(c => c.expiry_date).map(c => { const dl = daysUntil(c.expiry_date as string)!; return { title: `${c.title}`, date: c.expiry_date as string, sub: dl < 0 ? "expired" : `${dl}d left`, tone: dl < 0 ? "text-rose-600" : dl <= 30 ? "text-amber-600" : "text-gray-500" }; }).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 4);

  return { module: mod, summary, cpd: cpdRows, credentials, courses, domainScores, groups: MODULE_GROUPS[slug] ?? [], deadlines, aiConfigured: configured };
}
