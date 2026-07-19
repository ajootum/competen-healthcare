"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import type { CopilotContext } from "@/lib/copilot-context";

// AI Copilot Workspace (spec v1.0 + mockup). Four modes (Ask / Analyse / Create
// / Act). Ask & Analyse run the real grounded /api/ai/assistant; Create & Act
// present governed action cards that deep-link to the real builders/workflows
// (AI never auto-executes — human approval required). The right rail frames the
// chat with live intelligence. Conversation persistence & output saving are
// session-only for now (no store) — labelled honestly.

type Message = { role: "user" | "assistant"; content: string };
type Mode = "ask" | "analyse" | "create" | "act";

const MODES: { id: Mode; label: string; sub: string; icon: string }[] = [
  { id: "ask", label: "Ask", sub: "Get answers", icon: "💬" },
  { id: "analyse", label: "Analyse", sub: "Deep insights", icon: "🎯" },
  { id: "create", label: "Create", sub: "Generate content", icon: "✏️" },
  { id: "act", label: "Act", sub: "Take actions", icon: "⚡" },
];
const SUGGESTED = ["Analyse this curriculum", "Find competency gaps", "Generate an assessment blueprint", "Create a remediation plan", "Map this CPU to standards"];
const CREATE_CARDS: [string, string, string][] = [
  ["🏛️", "Curriculum & Frameworks", "/educator/studio/curriculum"], ["💠", "CPU & CKO", "/educator/studio/cko"],
  ["📝", "Assessment Blueprint", "/educator/studio/mapping"], ["🧪", "OSCE / Simulation", "/educator/simulation"],
  ["❓", "Question Bank", "/educator/questions"], ["🗂️", "Learning Resources", "/educator/library"],
];
const ACT_CARDS: [string, string, string][] = [
  ["📋", "Send for Validation", "/educator/validations"], ["🎯", "Create Remediation Plan", "/educator/interventions"],
  ["🗓️", "Schedule Assessment", "/educator/meetings"], ["🛡️", "Prepare Accreditation", "/educator/analytics/accreditation"],
];
const PRIO_CLS: Record<string, string> = { High: "bg-red-500/20 text-red-300 border-red-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };

export default function CopilotWorkspace({ ctx }: { ctx: CopilotContext }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("ask");
  const [outputs, setOutputs] = useState<{ title: string; type: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const asked = messages.filter(m => m.role === "user");

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setMessages(m => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
      const d = await res.json().catch(() => ({}));
      const answer = res.ok ? (d.answer ?? "No answer returned.")
        : res.status === 503 ? "The AI assistant isn't configured yet (no API key set). Ask your administrator to enable it — the rest of this workspace runs on your live institutional data."
        : res.status === 429 ? "AI rate limit reached for this hour — please try again shortly."
        : (d.error ?? "Something went wrong. Please try again.");
      setMessages(m => [...m.slice(0, -1), { role: "assistant", content: answer }]);
      if (res.ok) setOutputs(o => [{ title: q.length > 42 ? q.slice(0, 42) + "…" : q, type: mode === "analyse" ? "Analysis" : mode === "create" ? "Draft" : "Answer" }, ...o].slice(0, 6));
    } catch {
      setMessages(m => [...m.slice(0, -1), { role: "assistant", content: "Network error. Please check your connection and try again." }]);
    }
    setBusy(false);
  }

  function newSession() { setMessages([]); setInput(""); setOutputs([]); setMode("ask"); }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_320px] gap-3 min-h-[calc(100vh-9rem)] text-slate-200">
      {/* ── Left panel ── */}
      <div className="hidden xl:flex flex-col gap-3">
        <button onClick={newSession} className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-semibold py-2.5 hover:opacity-90 transition-opacity shadow-lg shadow-violet-600/25">＋ New Copilot Session</button>
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-3.5 flex-1 min-h-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Conversations</p>
          {asked.length === 0 ? <p className="text-[11px] text-slate-500">Your questions this session appear here.</p> : (
            <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
              {asked.slice().reverse().map((m, i) => (
                <button key={i} onClick={() => send(m.content)} className="text-left text-[11px] text-slate-300 hover:text-white leading-snug line-clamp-2 rounded-lg px-2 py-1.5 hover:bg-white/5">{m.content}</button>
              ))}
            </div>
          )}
          <p className="text-[9px] text-slate-500 mt-2 pt-2 border-t border-white/5">Saved history needs a conversation store — session-only for now.</p>
        </div>
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Current Context</p>
          <div className="flex flex-col gap-1.5 text-[11px]">
            <div className="flex justify-between"><span className="text-slate-500">Institution</span><span className="text-slate-200 truncate ml-2 text-right">{ctx.context.institution}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Frameworks</span><span className="text-slate-200">{ctx.context.frameworks}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Competencies</span><span className="text-slate-200">{ctx.context.competencies}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">CPUs</span><span className="text-slate-200">{ctx.context.cpus}</span></div>
          </div>
        </div>
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Data Access <span className="normal-case font-normal text-slate-500">(what Copilot sees)</span></p>
          <div className="flex flex-col gap-1">
            {ctx.dataAccess.map(a => (
              <div key={a.label} className="flex items-center gap-2 text-[11px]"><span className={a.allowed ? "text-emerald-400" : "text-slate-500"}>{a.allowed ? "✓" : "🔒"}</span><span className={a.allowed ? "text-slate-300" : "text-slate-500"}>{a.label}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Center workspace ── */}
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-lg shadow-lg shadow-violet-500/30">🤖</span>
          <div><h1 className="text-lg font-extrabold text-white leading-tight">AI Copilot</h1><p className="text-[11px] text-slate-400">Your intelligent educator assistant</p></div>
        </div>

        {/* Mode tabs */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          {MODES.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} className={`rounded-xl border p-2.5 text-left transition-colors ${mode === m.id ? "bg-violet-600/20 border-violet-500/40" : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06]"}`}>
              <span className="text-sm">{m.icon}</span>
              <p className="text-[12px] font-bold text-white leading-tight">{m.label}</p>
              <p className="text-[9px] text-slate-400">{m.sub}</p>
            </button>
          ))}
        </div>

        {/* Chat / builder area */}
        <div className="flex-1 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col overflow-hidden min-h-[360px]">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {messages.length === 0 && (mode === "create" || mode === "act") ? (
              <div className="flex-1">
                <p className="text-[11px] text-slate-400 mb-3">{mode === "create" ? "Generate governed content — opens the builder; AI drafts are saved for your review, never auto-published." : "Launch a governed workflow — every action requires your preview and approval. AI never executes on its own."}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(mode === "create" ? CREATE_CARDS : ACT_CARDS).map(([ic, label, href]) => (
                    <Link key={label} href={href} className="rounded-xl bg-white/[0.03] border border-white/10 p-3 hover:bg-white/[0.07] hover:border-white/25 transition-all"><span className="text-lg">{ic}</span><p className="text-[11px] font-semibold text-white mt-1 leading-tight">{label}</p></Link>
                  ))}
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 py-6 text-center">
                <span className="w-12 h-12 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-xl">✨</span>
                <div><p className="text-white font-semibold">Ask anything about your institution</p><p className="text-[12px] text-slate-400 mt-1 max-w-sm">Grounded in your frameworks, CPUs, competencies, assessments and standards — every answer is cited and audit-logged.</p></div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${m.role === "assistant" ? "bg-violet-600 text-white" : "bg-white/10 text-slate-300"}`}>{m.role === "assistant" ? "🤖" : "🧑"}</span>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${m.role === "assistant" ? "bg-white/[0.05] text-slate-200 rounded-tl-none" : "bg-violet-600 text-white rounded-tr-none"}`}>
                    {m.content ? <span className="whitespace-pre-wrap">{m.content}</span> : <span className="flex gap-1 items-center py-0.5">{[0, 1, 2].map(k => <span key={k} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${k * 0.15}s` }} />)}</span>}
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="border-t border-white/10 p-3">
            <div className="flex gap-2">
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} disabled={busy}
                placeholder={mode === "analyse" ? "Ask the Copilot to analyse something…" : "Ask Copilot anything…"}
                className="flex-1 bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50 disabled:opacity-50" />
              <button onClick={() => send()} disabled={!input.trim() || busy} className="bg-violet-600 hover:bg-violet-700 text-white px-4 rounded-xl disabled:opacity-40 transition-colors">{busy ? "…" : "➤"}</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {["📎 Attach File", "🧩 Attach Object", "📐 Add Standard", "👥 Add Learner Group", "📄 Use Template"].map(l => (
                <span key={l} title="Coming soon" className="text-[10px] text-slate-500 bg-white/[0.03] border border-white/10 rounded-lg px-2 py-1 select-none">{l}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Suggested prompts */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {SUGGESTED.map(s => <button key={s} onClick={() => { setMode("analyse"); send(s); }} className="text-[11px] text-violet-200 bg-violet-500/10 border border-violet-500/20 rounded-full px-3 py-1.5 hover:bg-violet-500/20 transition-colors">{s}</button>)}
        </div>
      </div>

      {/* ── Right rail ── */}
      <div className="hidden xl:flex flex-col gap-3">
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Intelligence Summary</p>
          <div className="grid grid-cols-2 gap-3 items-center">
            <div>
              <p className="text-[10px] text-slate-500">Confidence</p>
              <p className={`text-sm font-bold ${ctx.confidence === "High" ? "text-emerald-400" : ctx.confidence === "Medium" ? "text-amber-400" : "text-rose-400"}`}>{ctx.confidence}</p>
              <p className="text-[9px] text-slate-500 mt-1">Based on {ctx.confidence === "High" ? "complete" : "partial"} institutional data</p>
            </div>
            <div className="flex flex-col items-center">
              <div className="relative w-16 h-16">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                  {ctx.health !== null && <circle cx="18" cy="18" r="15.9" fill="none" stroke={ctx.health >= 80 ? "#22c55e" : ctx.health >= 60 ? "#84cc16" : ctx.health >= 40 ? "#f59e0b" : "#ef4444"} strokeWidth="3" strokeDasharray={`${ctx.health} 100`} strokeLinecap="round" />}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-sm font-extrabold text-white">{ctx.health ?? "—"}</span><span className="text-[7px] text-slate-500">/100</span></div>
              </div>
              <p className="text-[9px] text-slate-400 mt-0.5">Health Score</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">AI Reasoning <span className="normal-case font-normal text-slate-500">(rule-derived)</span></p>
          <ul className="space-y-1.5">{ctx.reasoning.map((r, i) => <li key={i} className="text-[11px] text-slate-300 flex gap-2"><span className="text-violet-400">•</span>{r}</li>)}</ul>
        </div>

        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Sources Used</p>
          <div className="flex flex-col gap-1">{ctx.sources.map(s => <p key={s} className="text-[11px] text-slate-300 flex gap-2"><span className="text-slate-500">📄</span>{s}</p>)}</div>
        </div>

        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Recommended Next Actions</p>
          <div className="flex flex-col gap-1.5">{ctx.recommendations.map((r, i) => (
            <Link key={i} href={r.href} className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-2.5 py-1.5 hover:bg-white/[0.06] transition-colors">
              <span className="text-[11px] text-slate-200 flex-1 leading-tight">{r.title}</span>
              <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${PRIO_CLS[r.priority]}`}>{r.priority}</span>
            </Link>
          ))}</div>
        </div>

        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Outputs This Session <span className="normal-case font-normal text-slate-500">({outputs.length})</span></p>
          {outputs.length === 0 ? <p className="text-[11px] text-slate-500">Copilot answers &amp; drafts appear here. Saving to a library needs a store — session-only for now.</p> : (
            <div className="flex flex-col gap-1.5">{outputs.map((o, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]"><span className="text-slate-500">📄</span><span className="text-slate-300 flex-1 truncate">{o.title}</span><span className="text-[8px] font-bold uppercase text-slate-500">{o.type}</span></div>
            ))}</div>
          )}
        </div>
      </div>
    </div>
  );
}
