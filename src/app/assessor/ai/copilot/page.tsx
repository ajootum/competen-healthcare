import { createAdminClient } from "@/lib/supabase/server";
import Link from "next/link";
import { requireAnalyticsAccess } from "@/lib/analytics";
import { AiHeader } from "../ui";
import CopilotChat, { type PinnedResource } from "@/app/dashboard/copilot/CopilotChat";

// AI Assessment Copilot — the assessor-shell home for the streaming Claude
// copilot (same governed chat engine as the clinician coach), with
// assessor-focused starter prompts and recent AI activity from the audit log.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ scenario?: string }>;

const STARTERS = [
  "Show learners who are overdue for reassessment and how I should prioritise them.",
  "Suggest probing questions for a medication-safety direct observation.",
  "How should I document a borderline performance fairly?",
  "Draft constructive feedback for a learner who failed an OSCE station.",
];

export default async function AiCopilotPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId } = await requireAnalyticsAccess();
  const { scenario } = await searchParams;
  const admin = createAdminClient();

  const [{ data: knowledge }, { data: cases }, { data: recent }] = await Promise.all([
    admin.from("knowledge_objects").select("id, title, knowledge_type")
      .neq("status", "retired").order("created_at", { ascending: false }).limit(3),
    admin.from("clinical_cases").select("id, title")
      .neq("status", "retired").order("created_at", { ascending: false }).limit(1),
    admin.from("audit_log").select("action, created_at")
      .eq("actor_id", userId).like("action", "ai_%")
      .order("created_at", { ascending: false }).limit(5),
  ]);

  const pinned: PinnedResource[] = [
    ...(knowledge ?? []).map(k => ({ id: k.id, title: k.title, kind: "knowledge" as const, type: k.knowledge_type as string })),
    ...(cases ?? []).map(c => ({ id: c.id, title: c.title, kind: "case" as const, type: "case study" })),
  ];

  return (
    <div className="max-w-6xl">
      <AiHeader icon="✨" title="AI Assessment Copilot" sub="Your intelligent assistant for assessments, evidence and competency decisions — streaming, grounded, audit-logged." />
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mr-1">Try asking…</span>
        {STARTERS.map(s => (
          <Link key={s} href={`/assessor/ai/copilot?scenario=${encodeURIComponent(s)}`}
            className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1.5 hover:bg-indigo-100 transition-colors">
            {s.length > 56 ? `${s.slice(0, 56)}…` : s}
          </Link>
        ))}
      </div>
      <CopilotChat pinned={pinned} autoPrompt={scenario ?? null} />
      {(recent ?? []).length > 0 && (
        <p className="text-[10px] text-gray-400 mt-3">
          Your recent AI activity: {(recent ?? []).map(r => r.action.replace("ai_", "").replace(/_/g, " ")).join(" · ")} —{" "}
          <Link href="/assessor/ai/history" className="text-indigo-500 hover:underline">full history</Link>.
          Conversations aren&apos;t stored; the audit trail records each AI action.
        </p>
      )}
    </div>
  );
}
