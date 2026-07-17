import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CopilotChat, { type PinnedResource } from "./CopilotChat";

// AI Clinical Coach — server shell: fetches the governed resources pinned in
// the rail (real reader links), renders the header, and mounts the streaming
// chat client. Voice input, file attachment and conversation persistence need
// infrastructure that doesn't exist yet — omitted, not faked.

export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  const { scenario } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: knowledge }, { data: cases }] = await Promise.all([
    admin.from("knowledge_objects").select("id, title, knowledge_type")
      .neq("status", "retired").order("created_at", { ascending: false }).limit(3),
    admin.from("clinical_cases").select("id, title")
      .neq("status", "retired").order("created_at", { ascending: false }).limit(1),
  ]);

  const pinned: PinnedResource[] = [
    ...(knowledge ?? []).map(k => ({ id: k.id, title: k.title, kind: "knowledge" as const, type: k.knowledge_type as string })),
    ...(cases ?? []).map(c => ({ id: c.id, title: c.title, kind: "case" as const, type: "case study" })),
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            AI Clinical Coach
            <span className="ml-2 text-[9px] font-bold bg-teal-50 text-teal-700 px-2 py-0.5 rounded align-middle">BETA</span>
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Evidence-based clinical guidance powered by Claude AI.</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full font-medium shrink-0">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
          Claude AI
        </span>
      </div>

      <CopilotChat pinned={pinned} autoPrompt={scenario ?? null} />
    </div>
  );
}
