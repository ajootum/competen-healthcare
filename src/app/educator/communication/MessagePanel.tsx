"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Communication panel — one-way messages over the notifications system via
// /api/messages (learner or all-educators), same engine as the cockpit.

export default function MessagePanel({ people }: { people: { id: string; name: string; dept: string }[] }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!text.trim() || !to) { setError("Pick a recipient and write a message."); return; }
    setBusy(true); setError(null); setSent(null);
    const res = await fetch("/api/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(to === "__educators__" ? { to_educators: true, text } : { recipient_id: to, text }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setSent(`Delivered to ${d.recipients} recipient${d.recipients === 1 ? "" : "s"}`);
      setText("");
      router.refresh();
    } else setError(d.error ?? "Message failed");
    setBusy(false);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <select value={to} onChange={e => { setTo(e.target.value); setSent(null); }}
          className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700 focus:outline-none focus:border-purple-400">
          <option value="">Recipient…</option>
          <option value="__educators__">📣 All educators (my hospital)</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name} · {p.dept}</option>)}
        </select>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={1000}
        placeholder="Write your message… (delivered as an in-app notification)"
        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600 focus:outline-none focus:border-purple-400" />
      <div className="flex items-center gap-3 mt-2">
        <button onClick={send} disabled={busy}
          className="text-xs font-bold text-white bg-purple-600 rounded-lg px-4 py-2 hover:bg-purple-700 disabled:opacity-50 transition-colors">
          {busy ? "Sending…" : "Send message"}
        </button>
        {sent && <span className="text-[11px] text-green-600">✓ {sent}</span>}
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
    </div>
  );
}
