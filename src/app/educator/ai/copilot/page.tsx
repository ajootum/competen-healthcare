import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCopilotContext } from "@/lib/copilot-context";
import CopilotWorkspace from "./CopilotWorkspace";

// AI Copilot Workspace (AI & Intelligence › AI Copilot). Dark command-centre
// shell; the interactive chat + panels live in CopilotWorkspace. Context and
// intelligence are computed live; the chat runs the real grounded assistant.

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadCopilotContext(admin, hospitalId ?? "");

  return (
    <div className="max-w-[1500px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.12),transparent_60%)] min-h-screen px-4 md:px-6 py-5">
        <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-4">
          <Link href="/educator/ai" className="hover:text-slate-200">AI &amp; Intelligence</Link>
          <span className="text-slate-600">›</span>
          <span className="text-slate-200 font-semibold">AI Copilot</span>
        </div>
        <CopilotWorkspace ctx={ctx} />
      </div>
    </div>
  );
}
