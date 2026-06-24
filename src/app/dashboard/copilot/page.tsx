"use client";
import { useState, useRef, useEffect } from "react";

type Message = { role: "user" | "assistant"; content: string };

const suggestions = [
  "BLS protocol for adults",
  "Medication 10 Rights",
  "WHO hand hygiene moments",
  "Pediatric triage — ETAT+",
  "Signs of sepsis",
  "Anaphylaxis management",
];

export default function CopilotPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text?: string) {
    const query = (text ?? input).trim();
    if (!query || streaming) return;
    setInput("");

    const newMessages: Message[] = [...messages, { role: "user", content: query }];
    setMessages(newMessages);
    setStreaming(true);

    // Add empty assistant placeholder
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
      let accumulated = "";

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
                accumulated += parsed.text;
                setMessages(prev => [
                  ...prev.slice(0, -1),
                  { role: "assistant", content: accumulated },
                ]);
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
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-4 flex items-start justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">AI Clinical Copilot</h1>
          <p className="text-gray-400 text-sm mt-0.5">Evidence-based clinical guidance powered by Claude AI.</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full font-medium">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
          Claude AI
        </span>
      </div>

      <div className="flex-1 bg-white rounded-xl border border-gray-100 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
              <div className="w-14 h-14 rounded-2xl bg-teal-600 flex items-center justify-center text-2xl">🤖</div>
              <div className="text-center">
                <p className="font-semibold text-gray-800">AI Clinical Copilot</p>
                <p className="text-sm text-gray-400 mt-1 max-w-sm">Ask any clinical question — BLS, medications, infection control, pediatrics, assessment, and more.</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {suggestions.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="text-xs bg-teal-50 text-teal-700 px-3 py-1.5 rounded-full hover:bg-teal-100 transition-colors font-medium border border-teal-100">
                    {s}
                  </button>
                ))}
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
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-gray-300 mt-2 shrink-0">
        Educational use only · Not a substitute for clinical judgment · Always follow hospital protocols
      </p>
    </div>
  );
}
