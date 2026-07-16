import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import QuickCreate from "./QuickCreate";
import LibrarySearch from "@/app/dashboard/library/LibrarySearch";

// COMPETEN Studio — the clinical knowledge engineering environment.
// Home answers "what needs my attention today?" (Studio UX spec §6), with
// global search (§7), Quick Create (§8) and the builder modules.

export default async function StudioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const today = new Date().toISOString().slice(0, 10);
  const [
    { count: drafts }, { count: inReview }, { count: readyToPublish },
    { count: reviewsDue }, { count: skills }, { count: checklists },
    { count: comps }, { count: cpus }, { count: banks }, respDueRes,
  ] = await Promise.all([
    admin.from("frameworks").select("id", { count: "exact" }).eq("is_active", true).eq("pub_status", "draft").limit(1),
    admin.from("content_approvals").select("id", { count: "exact" }).eq("status", "pending").limit(1),
    admin.from("frameworks").select("id", { count: "exact" }).eq("is_active", true).eq("pub_status", "approved").limit(1),
    admin.from("frameworks").select("id", { count: "exact" }).eq("is_active", true).lt("review_date", today).limit(1),
    admin.from("skill_library").select("id", { count: "exact" }).eq("is_active", true).limit(1),
    admin.from("skill_checklists").select("id", { count: "exact" }).eq("is_active", true).limit(1),
    admin.from("framework_competencies").select("id", { count: "exact" }).limit(1),
    admin.from("clinical_practice_units").select("id", { count: "exact" }).limit(1),
    admin.from("question_banks").select("id", { count: "exact" }).eq("is_active", true).limit(1),
    admin.from("content_responsibilities").select("id", { count: "exact" }).eq("status", "active").lt("review_due", today).limit(1),
  ]);
  const respDue = respDueRes.count ?? 0;

  const ATTENTION = [
    { label: "Draft frameworks", value: drafts ?? 0, icon: "📝", href: "/super-admin/content", cls: (drafts ?? 0) > 0 ? "text-blue-600" : "text-gray-300" },
    { label: "Awaiting review", value: inReview ?? 0, icon: "⚖️", href: "/admin/approvals", cls: (inReview ?? 0) > 0 ? "text-amber-600" : "text-gray-300" },
    { label: "Ready for publication", value: readyToPublish ?? 0, icon: "🚀", href: "/super-admin/content", cls: (readyToPublish ?? 0) > 0 ? "text-teal-600" : "text-gray-300" },
    { label: "Framework reviews due", value: reviewsDue ?? 0, icon: "⏰", href: "/super-admin/content", cls: (reviewsDue ?? 0) > 0 ? "text-red-500" : "text-gray-300" },
    { label: "Ownership reviews due", value: respDue, icon: "🧾", href: "/super-admin/studio/responsibilities", cls: respDue > 0 ? "text-red-500" : "text-gray-300" },
  ];

  const BUILDERS = [
    { icon: "🪪", label: "Competency Builder", desc: "Author competencies inside frameworks — profiles, skills, evidence, publishing", href: "/super-admin/content", stat: `${comps ?? 0} competencies` },
    { icon: "✋", label: "Skill Builder", desc: "Reusable skill objects — write once, attach to many competencies", href: "/super-admin/studio/skills", stat: `${skills ?? 0} library skills` },
    { icon: "☑️", label: "Checklist Builder", desc: "Structured checklists — sections, scoring rules, critical-fail items", href: "/super-admin/studio/checklists", stat: `${checklists ?? 0} checklists` },
    { icon: "🏥", label: "Practices & CPU Library", desc: "Cross-framework view of every practice and CPU — counts, status, one-click clone", href: "/super-admin/studio/cpus", stat: `${cpus ?? 0} CPUs` },
    { icon: "🩺", label: "Assessment Builder", desc: "Blueprints, methods, weights, consensus rules and evidence matrices", href: "/super-admin/assessment-methods", stat: null },
    { icon: "❓", label: "Question Builder", desc: "Governed MCQ banks — pass marks, validity, CPU-linked knowledge tests", href: "/super-admin/studio/questions", stat: `${banks ?? 0} banks` },
    { icon: "📚", label: "Learning Builder", desc: "Learning resources and pathways (managed in the Admin portal)", href: "/admin/resources", stat: null },
    { icon: "📎", label: "Evidence Builder", desc: "Evidence requirements per CPU — types, quantities, validity", href: "/super-admin/content", stat: null },
    { icon: "🗂️", label: "Version Control", desc: "Semantic versions, change requests, impact analysis — never edit live content", href: "/super-admin/content", stat: null },
    { icon: "🧾", label: "Ownership & Responsibilities", desc: "Accountable owners for every content object — product owners, reviewers, publishers", href: "/super-admin/studio/responsibilities", stat: null },
    { icon: "⚖️", label: "Approval Queue", desc: "Governance review before publication — separation of duties enforced", href: "/admin/approvals", stat: (inReview ?? 0) > 0 ? `${inReview} in review` : "queue empty" },
    { icon: "📖", label: "Published Library", desc: "Everything currently live across the platform", href: "/super-admin/competencies", stat: null },
  ];

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">COMPETEN Studio</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Clinical knowledge engineering — structured, version-controlled, governed content with owners and evidence.
          </p>
        </div>
        <QuickCreate />
      </div>

      {/* What needs my attention today? */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {ATTENTION.map(w => (
          <Link key={w.label} href={w.href}
            className="bg-white rounded-xl border border-gray-100 p-4 hover:border-teal-200 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span>{w.icon}</span>
              <p className={`text-2xl font-bold ${w.cls}`}>{w.value}</p>
            </div>
            <p className="text-[10px] text-gray-400 font-medium">{w.label}</p>
          </Link>
        ))}
      </div>

      {/* Global search across the governed knowledge base */}
      <div className="mb-8">
        <LibrarySearch />
      </div>

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Builders &amp; Governance</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {BUILDERS.map(b => (
          <Link key={b.label} href={b.href}
            className="bg-white rounded-xl border border-gray-100 p-5 hover:border-teal-200 hover:shadow-sm transition-all group">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{b.icon}</span>
              <p className="font-bold text-gray-900 text-sm group-hover:text-teal-700">{b.label}</p>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{b.desc}</p>
            {b.stat && <p className="text-[10px] font-semibold text-teal-600 mt-2">{b.stat}</p>}
          </Link>
        ))}
      </div>

      <div className="mt-8 bg-teal-50 border border-teal-100 rounded-xl p-5">
        <p className="text-xs font-bold text-teal-700 uppercase tracking-widest mb-2">Recommended workflow</p>
        <p className="text-sm text-teal-900">
          Create Domain → Create CPU → Create Competencies → Create Skills → Create Checklist → Create Assessment → Link Learning → Review → Publish.
          Reverse building works too — start with a checklist and link it upward later.
        </p>
      </div>
    </div>
  );
}
