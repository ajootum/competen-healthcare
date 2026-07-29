import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

// CDP-000 — Competency Delivery Platform. The DELIVERY/runtime layer: CST authors → CMO governs → CDP
// delivers → workspaces consume. This hub maps the 15 CDP engines to their REAL surfaces and honestly flags
// what's partial (a runtime loop missing) or genuinely absent (net-new). Counts are live from real stores.
// No migration — a single-source-of-truth view over delivery infrastructure that already exists.

export const dynamic = "force-dynamic";

type Status = "real" | "partial" | "gap";
type Mod = { code: string; icon: string; label: string; desc: string; href?: string; status: Status };

const BADGE: Record<Status, { text: string; cls: string }> = {
  real: { text: "Live", cls: "text-teal-700 bg-teal-50 border-teal-100" },
  partial: { text: "Partial", cls: "text-amber-600 bg-amber-50 border-amber-100" },
  gap: { text: "Planned", cls: "text-gray-400 bg-gray-50 border-gray-100" },
};

function EngineCard({ m }: { m: Mod }) {
  const b = BADGE[m.status];
  const inner = (
    <>
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="text-xl shrink-0">{m.icon}</span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold text-gray-300 tracking-widest">{m.code}</p>
          <p className={`font-bold text-sm leading-tight ${m.status === "gap" ? "text-gray-500" : "text-gray-900 group-hover:text-violet-700"}`}>{m.label}</p>
        </div>
        <span className={`ml-auto shrink-0 text-[8px] font-bold uppercase tracking-wide border px-1.5 py-0.5 rounded ${b.cls}`}>{b.text}</span>
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed">{m.desc}</p>
    </>
  );
  const base = "bg-white rounded-xl border border-gray-100 p-4 block";
  return m.href
    ? <Link href={m.href} className={`${base} hover:border-violet-200 hover:shadow-sm transition-all group`}>{inner}</Link>
    : <div className={`${base} opacity-80`}>{inner}</div>;
}

function Layer({ title, mods }: { title: string; mods: Mod[] }) {
  return (
    <>
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-7">{mods.map(m => <EngineCard key={m.code} m={m} />)}</div>
    </>
  );
}

export default async function DeliveryPlatformPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const c = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count ?? 0).catch(() => 0);
  const [courses, assigned, assessments, simulations, certifications, events] = await Promise.all([
    c(admin.from("learning_courses").select("id", { count: "exact", head: true })),
    c(admin.from("cmo_assignments").select("id", { count: "exact", head: true })),
    c(admin.from("question_banks").select("id", { count: "exact", head: true }).eq("is_active", true)),
    c(admin.from("simulation_scenarios").select("id", { count: "exact", head: true })),
    c(admin.from("cmo_certifications").select("id", { count: "exact", head: true })),
    c(admin.from("domain_events").select("id", { count: "exact", head: true })),
  ]);
  const STATS = [
    { label: "Courses", value: courses, icon: "📚" },
    { label: "Competencies assigned", value: assigned, icon: "🎯" },
    { label: "Assessment banks", value: assessments, icon: "❓" },
    { label: "Simulations", value: simulations, icon: "🎬" },
    { label: "Certifications", value: certifications, icon: "🏅" },
    { label: "Delivery events", value: events, icon: "📡" },
  ];

  const ORCHESTRATION: Mod[] = [
    { code: "CDP-001", icon: "🧭", label: "Delivery Orchestrator", desc: "Evaluates active assignment rules and materialises pending competency deliveries (+ emits competency.assigned events); runs daily via cron. Reacting to inbound events is the next layer.", href: "/super-admin/delivery/orchestrator", status: "real" },
    { code: "CDP-008", icon: "📣", label: "Assignment & Campaign Manager", desc: "Standing assignment rules (COMP-018) plus deadline-driven learning campaigns: target a cohort, launch → materialise assignments + events, track live compliance.", href: "/super-admin/delivery/campaigns", status: "real" },
    { code: "CDP-014", icon: "⚖️", label: "Governance & Delivery Config", desc: "WCE governs workspace composition; learning-delivery policy (cadence/escalation/routing) is the gap.", href: "/super-admin/platform-ops/configuration", status: "partial" },
    { code: "CDP-015", icon: "🔌", label: "APIs & Event Bus", desc: "domain_events outbox + typed emit helpers are real; the event consumer/dispatcher that drives side-effects is the gap.", href: "/competency-office/integration", status: "partial" },
  ];
  const EXPERIENCE: Mod[] = [
    { code: "CDP-002", icon: "🎓", label: "Learning Experience Platform", desc: "Courses, resources, pathways and the enrol→progress→complete runtime — live across the worker, educator & LDS surfaces.", href: "/unit-manager/learning", status: "real" },
    { code: "CDP-003", icon: "🧬", label: "Adaptive Learning Engine", desc: "Real computerised adaptive testing (1PL/Rasch ability estimate, max-information item selection, SE stopping) over the authored blueprints. Learners take it at /dashboard/adaptive.", href: "/super-admin/studio/adaptive", status: "real" },
    { code: "CDP-004", icon: "🔁", label: "Microlearning & Reinforcement", desc: "SM-2 spaced-repetition cards generated from achieved competencies; learners self-grade recall so retention doesn't decay. Learner loop at /dashboard/reinforcement.", href: "/super-admin/delivery/reinforcement", status: "real" },
  ];
  const PRACTICE: Mod[] = [
    { code: "CDP-005", icon: "🎬", label: "Clinical Simulation & Practice", desc: "Scenario authoring + branching delivery are real; flow-builder / mock-code orchestration is next-phase.", href: "/super-admin/studio/simulations", status: "partial" },
    { code: "CDP-006", icon: "📝", label: "Assessment Delivery", desc: "Quiz / OSCE / DOPS / Mini-CEX delivery, attempts, sessions, scoring & evidence — all live.", href: "/assessor", status: "real" },
  ];
  const COACHING: Mod[] = [
    { code: "CDP-007", icon: "🤖", label: "AI Coaching & Clinical Tutor", desc: "Grounded copilot pattern (AiCopilotPanel + /api/<domain>/copilot) over the governed AI gateway; embedded platform-wide.", href: "/super-admin/ai", status: "real" },
    { code: "CDP-009", icon: "🏅", label: "Certification & Credentialing", desc: "Certificates, passports, CPD, renewals, share/verify — full credential lifecycle live.", href: "/competency-office/certifications", status: "real" },
  ];
  const REACH: Mod[] = [
    { code: "CDP-010", icon: "📈", label: "Learning Analytics & Impact", desc: "Learner / cohort / course / faculty / trend analytics + readiness snapshots. Causal learning-impact is partial.", href: "/unit-manager/learning/analytics", status: "real" },
    { code: "CDP-011", icon: "🔔", label: "Notifications & Engagement", desc: "In-app notifications + a scheduled reminder engine (daily cron nudges learners before credentials/competencies expire, deduped). Omnichannel (email/push) & gamification are next.", href: "/super-admin/delivery/reminders", status: "real" },
    { code: "CDP-012", icon: "📴", label: "Offline & Mobile Learning", desc: "PWA, offline sync, downloadable content. Net-new (infrastructure-heavy).", status: "gap" },
    { code: "CDP-013", icon: "🔗", label: "External Content & LMS Integration", desc: "SCORM / xAPI / LTI, external LMS import & record sync. Net-new.", status: "gap" },
  ];

  const all = [...ORCHESTRATION, ...EXPERIENCE, ...PRACTICE, ...COACHING, ...REACH];
  const nReal = all.filter(m => m.status === "real").length;
  const nPartial = all.filter(m => m.status === "partial").length;
  const nGap = all.filter(m => m.status === "gap").length;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-widest mb-0.5">CDP-000 · Competency Delivery Platform</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Delivery</h1>
          <p className="text-gray-400 text-sm mt-0.5">The runtime layer — the right competency to the right learner at the right time. Studio authors, the Office governs, Delivery runs it, workspaces consume.</p>
        </div>
        <Link href="/super-admin" className="text-xs font-semibold text-gray-500 hover:text-violet-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Mission Control</Link>
      </div>

      {/* Live delivery stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-5">
        {STATS.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
            <div className="flex items-center justify-between mb-1"><span className="text-sm">{s.icon}</span><p className="text-lg font-bold text-gray-900">{s.value}</p></div>
            <p className="text-[10px] text-gray-400 font-medium leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Coverage summary */}
      <div className="flex items-center gap-2 mb-5 text-[11px]">
        <span className="font-semibold text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-2.5 py-1">{nReal} live</span>
        <span className="font-semibold text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1">{nPartial} partial (runtime loop)</span>
        <span className="font-semibold text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">{nGap} planned (net-new)</span>
      </div>

      <Layer title="Orchestration & Governance · CDP-001/008/014/015" mods={ORCHESTRATION} />
      <Layer title="Learning Experience & Adaptation · CDP-002/003/004" mods={EXPERIENCE} />
      <Layer title="Practice & Assessment · CDP-005/006" mods={PRACTICE} />
      <Layer title="Coaching & Certification · CDP-007/009" mods={COACHING} />
      <Layer title="Analytics, Engagement & Reach · CDP-010/011/012/013" mods={REACH} />

      <div className="bg-violet-50 border border-violet-100 rounded-xl p-4">
        <p className="text-[11px] text-violet-900">
          <span className="font-bold">One delivery runtime, many surfaces.</span> Most of CDP already exists — the learning, assessment, coaching, certification and analytics engines are live in the worker/educator/office surfaces. The load-bearing gap is a real <span className="font-semibold">delivery orchestrator</span>: the outbox (domain_events), assignment rules, snapshots and a cron runner all exist, but nothing yet consumes events or evaluates rule triggers to schedule and push delivery. Closing that loop (CDP-001 + CDP-015) turns these surfaces into an actual runtime — that is the next build.
        </p>
      </div>
    </div>
  );
}
