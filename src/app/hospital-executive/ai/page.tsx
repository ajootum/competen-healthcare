import { hexGuard, Head, Card, Foot } from "../_ui";
import AiCopilotPanel from "@/components/AiCopilotPanel";
import Link from "next/link";

export const dynamic = "force-dynamic";

// HEX AI Executive Advisor — the live executive copilot as a focused advisory surface.
const PROMPTS = [
  "Give me a board-ready executive briefing",
  "What are the top enterprise risks right now?",
  "Where is organisational readiness weakest?",
  "Summarise quality & safety this month",
  "Which strategic objectives are lagging?",
  "What needs leadership attention this week?",
];

export default async function AiAdvisorPage() {
  await hexGuard();
  return (
    <div className="space-y-4">
      <Head code="Hospital Executive" title="AI Executive Advisor" sub="Ask anything about your organisation — grounded in your live executive data, board-ready." />

      <AiCopilotPanel endpoint="/api/executive-ai/copilot" title="Executive Advisor — live copilot" sublabel="Grounded in your live scorecard, workforce, quality, risk & operations · logged to the AI gateway" placeholder="Ask a board-level question…" prompts={["Executive briefing", "Top enterprise risks", "What needs leadership attention?", "Summarise quality & safety"]} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="What the advisor can answer">
          <div className="grid grid-cols-1 gap-1.5">
            {PROMPTS.map((p, i) => <div key={i} className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-[12.5px] text-gray-700"><span className="text-violet-500">✦</span>{p}</div>)}
          </div>
        </Card>

        <Card title="How it works">
          <div className="space-y-2 text-[12.5px] text-gray-600">
            <p><b className="text-gray-800">Grounded, not generic.</b> Every answer is built from your live, tenant-scoped executive data — the scorecard, workforce, quality, risk register and operations snapshots — never invented.</p>
            <p><b className="text-gray-800">Governed &amp; auditable.</b> Each call runs through the real AI Runtime Gateway and is logged to <code>plat_ai_requests</code>, so spend, latency and prompts surface in the AI Services Platform.</p>
            <p><b className="text-gray-800">Advisory only.</b> The advisor supports decisions; it does not make clinical or final governance decisions — those stay with the accountable executives.</p>
            <p className="pt-1"><Link href="/hospital-executive/intelligence" className="text-teal-600 hover:underline">Open the full Executive Intelligence centre →</Link></p>
          </div>
        </Card>
      </div>

      <Foot>The AI Executive Advisor is the same real LLM copilot embedded in the Executive Intelligence centre (HEX-002/010), surfaced here as a focused advisory page. It is grounded in this workspace&apos;s live data via the AI Runtime Gateway and every interaction is metered and auditable. Persisted advisory sessions and briefing history are the next build phase.</Foot>
    </div>
  );
}
