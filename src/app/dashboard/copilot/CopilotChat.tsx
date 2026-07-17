"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";

// AI Clinical Coach workspace (AI Copilot Redesign spec v1). The streaming
// chat is unchanged; around it: suggested prompts, ask-about categories,
// pinned governed resources (real reader links), this-session question
// history, and the escalation/safety guidance the spec requires.

type Message = { role: "user" | "assistant"; content: string };
export type PinnedResource = { id: string; title: string; kind: "knowledge" | "case"; type: string };

const suggestions = [
  "BLS protocol for adults",
  "Medication 10 Rights",
  "WHO hand hygiene moments",
  "Pediatric triage — ETAT+",
  "Signs of sepsis",
  "Anaphylaxis management",
];

const CATEGORIES = [
  { icon: "🩺", label: "Assessments", sub: "Physical exams, scoring systems, risk assessments", prompt: "What should a complete patient assessment cover? Cite the relevant competencies." },
  { icon: "💊", label: "Medications", sub: "Dosing, interactions, side effects", prompt: "Walk me through the 10 Rights of medication administration." },
  { icon: "🛡️", label: "Protocols", sub: "Hospital protocols, guidelines, pathways", prompt: "Which governed protocols and guidelines do we have in the library?" },
  { icon: "❤️", label: "Patient Care", sub: "Care plans, education, best practices", prompt: "How do I educate a patient and family about oxygen therapy at discharge?" },
];

export default function CopilotChat({ pinned, autoPrompt }: { pinned: PinnedResource[]; autoPrompt?: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSent = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Launch prompt (e.g. a Simulation Lab scenario) — sent once on arrival.
  useEffect(() => {
    if (autoPrompt && !autoSent.current) {
      autoSent.current = true;
      send(autoPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt]);

  const asked = messages.filter(m => m.role === "user").slice(-4).reverse();

  async function send(text?: string) {
    const query = (text ?? input).trim();
    if (!query || streaming) return;
    setInput("");

    const newMessages: Message[] = [...messages, { role: "user", content: query }];
    setMessages(newMessages);
    setStreaming(true);
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages(prev => [
          ...prev.slice(0, -1),
          { role: "assistant", content: err.error ?? "Something went wrong. Please try again." },
        ]);
        setStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const raw = decoder.decode(value, { stream: true });
        for (const line of raw.split("\n")) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.error) {
                setMessages(prev => [
                  ...prev.slice(0, -1),
                  { role: "assistant", content: `⚠️ ${parsed.error.includes("credit") ? "AI service is temporarily unavailable. Please contact support." : parsed.error}` },
                ]);
              } else if (parsed.text) {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  return [
                    ...prev.slice(0, -1),
                    { role: "assistant", content: (last?.role === "assistant" ? last.content : "") + parsed.text },
                  ];
                });
              }
            } catch {}
          }
        }
      }
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: "assistant", content: "Network error. Please check your connection and try again." },
      ]);
    }

    setStreaming(false);
    inputRef.current?.focus();
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_270px] gap-5">
      {/* Chat column */}
      <div className="min-w-0 flex flex-col h-[calc(100vh-11rem)]">
        <div className="flex-1 bg-white rounded-xl border border-gray-100 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

            {messages.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-5 py-6">
                <div className="w-14 h-14 rounded-2xl bg-teal-600 flex items-center justify-center text-2xl">🤖</div>
                <div className="text-center">
                  <p className="font-semibold text-gray-800 text-lg">Your AI Clinical Coach</p>
                  <p className="text-sm text-gray-400 mt-1 max-w-sm">
                    Ask any clinical question and get evidence-based guidance on assessments, medications, protocols and patient care.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                  {suggestions.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="text-xs bg-teal-50 text-teal-700 px-3 py-1.5 rounded-full hover:bg-teal-100 transition-colors font-medium border border-teal-100">
                      {s}
                    </button>
                  ))}
                </div>
                <div className="w-full max-w-2xl">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 text-center">Try asking about</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {CATEGORIES.map(c => (
                      <button key={c.label} onClick={() => send(c.prompt)}
                        className="border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 rounded-xl p-3 text-left transition-colors">
                        <p className="text-lg">{c.icon}</p>
                        <p className="text-[11px] font-semibold text-gray-800 mt-1">{c.label}</p>
                        <p className="text-[9px] text-gray-400 leading-tight mt-0.5">{c.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${
                  msg.role === "assistant" ? "bg-teal-600 text-white" : "bg-gray-200 text-gray-600"
                }`}>
                  {msg.role === "assistant" ? "🤖" : "👤"}
                </div>
                <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "assistant"
                    ? "bg-gray-50 text-gray-800 rounded-tl-none"
                    : "bg-teal-600 text-white rounded-tr-none"
                }`}>
                  {msg.content ? (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  ) : (
                    <span className="flex gap-1 items-center py-0.5">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-gray-100 p-3 flex gap-2 shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Ask a clinical question…"
              disabled={streaming}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
            />
            <button onClick={() => send()} disabled={!input.trim() || streaming}
              className="bg-teal-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors">
              {streaming ? "…" : "Send ➤"}
            </button>
          </div>
        </div>

        <div className="mt-2 bg-white rounded-xl border border-gray-100 px-4 py-2.5 flex items-center gap-2 shrink-0">
          <span className="text-gray-300">ℹ️</span>
          <p className="text-[11px] text-gray-400">
            The Coach provides clinical information for educational purposes only and is not a substitute for clinical judgment.
            Always follow hospital protocols and consult your clinical leads when needed.
          </p>
        </div>
      </div>

      {/* Right rail */}
      <div className="hidden xl:flex flex-col gap-4">
        {pinned.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <h2 className="text-xs font-bold text-gray-800 mb-2.5">📌 Governed Resources</h2>
            <div className="flex flex-col gap-2">
              {pinned.map(p => (
                <Link key={p.id}
                  href={p.kind === "case" ? `/dashboard/knowledge/case/${p.id}` : `/dashboard/knowledge/${p.id}`}
                  className="group">
                  <p className="text-[11px] text-gray-700 group-hover:text-teal-700 leading-snug">{p.title}</p>
                  <p className="text-[9px] text-gray-400 capitalize">{p.type.replace(/_/g, " ")}</p>
                </Link>
              ))}
            </div>
            <Link href="/dashboard/knowledge" className="block mt-2.5 text-[10px] font-semibold text-teal-600 hover:underline">
              View all resources →
            </Link>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-xs font-bold text-gray-800 mb-2.5">🕐 This Session</h2>
          {asked.length ? (
            <div className="flex flex-col gap-1.5">
              {asked.map((m, i) => (
                <button key={i} onClick={() => send(m.content)}
                  className="text-left text-[11px] text-gray-600 hover:text-teal-700 leading-snug line-clamp-2">
                  {m.content}
                </button>
              ))}
            </div>
          ) : <p className="text-[10px] text-gray-400">Your questions this session appear here — click to ask again.</p>}
        </div>

        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
          <h2 className="text-xs font-bold text-orange-800 mb-1.5">⚠️ Need escalation?</h2>
          <p className="text-[11px] text-orange-900/80 leading-relaxed">
            If this is an emergency or a patient is deteriorating, stop and escalate immediately —
            call your charge nurse, rapid response or emergency team per your unit&apos;s protocol. Do not wait for the AI.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[10px] text-gray-400 leading-relaxed">
            Answers are grounded in your organisation&apos;s governed content — frameworks, CPUs,
            knowledge objects, cases, policies and quality standards — with citations.
          </p>
        </div>
      </div>
    </div>
  );
}
