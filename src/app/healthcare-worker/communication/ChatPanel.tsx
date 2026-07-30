"use client";

import { useCallback, useEffect, useState } from "react";

// Team messaging (HWW-COM-001) over the ward board (op_messages): channel
// switcher, live feed (30s poll) and composer — the nurse is a first-class
// participant on the tenant's shared channels.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const fmtWhen = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "";

export default function ChatPanel({ channels: initialChannels }: { channels: string[] }) {
  const channels = initialChannels.length ? initialChannels : ["General"];
  const [channel, setChannel] = useState(channels[0]);
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refetch = useCallback(async (ch: string) => {
    const r = await fetch(`/api/operations/messages?channel=${encodeURIComponent(ch)}`);
    if (r.ok) setMessages(await r.json().catch(() => []));
  }, []);

  useEffect(() => {
    let active = true;
    (async () => { if (active) await refetch(channel); })();
    const t = setInterval(() => refetch(channel), 30000);
    return () => { active = false; clearInterval(t); };
  }, [channel, refetch]);

  async function send() {
    if (!body.trim()) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/operations/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, context_type: "team", body }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed to send"); return; }
    setBody("");
    refetch(channel);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <h3 className="font-semibold text-gray-900 mr-2">💬 Team Channels</h3>
        {channels.map(ch => (
          <button key={ch} onClick={() => setChannel(ch)}
            className={`px-2.5 py-1 rounded-full text-xs ${channel === ch ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            {ch}
          </button>
        ))}
      </div>
      <div className="border border-gray-100 rounded-lg max-h-80 overflow-y-auto divide-y divide-gray-50">
        {messages.length === 0 && <p className="text-sm text-gray-400 p-4">No messages in {channel} yet — start the conversation.</p>}
        {messages.slice().reverse().map((m: any) => (
          <div key={m.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700">{m.author_name ?? "Colleague"}</span>
              {m.context_type && m.context_type !== "team" && <span className="text-[9px] uppercase tracking-wide text-gray-400">{m.context_type}</span>}
              <span className="ml-auto text-[10px] text-gray-400">{fmtWhen(m.created_at)}</span>
            </div>
            <p className="text-sm text-gray-700 mt-0.5">{m.body}</p>
          </div>
        ))}
      </div>
      {err && <p className="text-xs text-amber-700 mt-2">{err}</p>}
      <div className="flex gap-2 mt-3">
        <input className={input} placeholder={`Message ${channel}…`} value={body} onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className={btn} disabled={busy || !body.trim()} onClick={send}>Send</button>
      </div>
      <p className="text-[10px] text-gray-400 mt-2">The ward board is visible to your whole clinical team — keep patient references operational (bed/initials), never clinical documentation.</p>
    </div>
  );
}
