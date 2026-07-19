"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// AI Analytics Assistant — natural-language analytics. Routes the question to
// the real AI Educator Copilot (grounded, audit-logged) rather than faking an
// answer here.
const EXAMPLES = [
  "Which learners are most likely to fail next month?",
  "Which course has the highest dropout?",
  "Which competency is deteriorating?",
  "Compare my cohorts.",
];

export default function AskAssistant() {
  const router = useRouter();
  const [q, setQ] = useState("");

  function ask(text: string) {
    const question = text.trim();
    if (!question) return;
    const prompt = `As my learning-analytics assistant, using my hospital's live data: ${question}`;
    router.push(`/dashboard/copilot?scenario=${encodeURIComponent(prompt)}`);
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && ask(q)}
          placeholder="Ask a question about your data…"
          className="flex-1 text-[12px] border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-purple-400" />
        <button onClick={() => ask(q)} disabled={!q.trim()}
          className="text-[12px] font-bold text-white bg-purple-600 rounded-lg px-4 py-2 hover:bg-purple-700 disabled:opacity-40 transition-colors">Ask</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {EXAMPLES.map(x => (
          <button key={x} onClick={() => ask(x)} className="text-[10px] text-purple-700 bg-purple-50 border border-purple-100 rounded-full px-2.5 py-1 hover:bg-purple-100 transition-colors">{x}</button>
        ))}
      </div>
      <p className="text-[9px] text-gray-300 mt-2">Answers open in the AI Educator Copilot, grounded in your live records and audit-logged.</p>
    </div>
  );
}
