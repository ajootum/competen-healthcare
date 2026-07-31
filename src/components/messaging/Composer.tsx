"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// PW-005 message composer — sends to the selected channel via POST /api/messages/channel (own-hospital, author
// from the caller's profile), then refreshes the server thread. The user composes and sends their own message.
export default function Composer({ channel, contextType }: { channel: string | null; contextType?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = () => {
    const body = text.trim();
    if (!body || !channel) return;
    start(async () => {
      setErr(null);
      const r = await fetch("/api/messages/channel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, context_type: contextType ?? "team", body }) }).catch(() => null);
      if (r?.ok) { setText(""); router.refresh(); }
      else { const j = await r?.json().catch(() => null); setErr(j?.error ?? "Failed to send"); }
    });
  };

  return (
    <div className="border-t border-gray-100 p-3">
      {err && <p className="text-[11px] text-[var(--cmp-text-error)] mb-1.5">{err}</p>}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={channel ? `Message ${channel}…` : "Select a conversation"}
          disabled={!channel || pending}
          rows={1}
          className="flex-1 resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50 max-h-28"
        />
        <button onClick={send} disabled={!text.trim() || !channel || pending} className="text-sm font-medium text-white bg-[var(--cmp-color-information)] rounded-lg px-4 py-2 hover:bg-[var(--cmp-color-information)] disabled:opacity-40 shrink-0">{pending ? "…" : "Send"}</button>
      </div>
      <p className="text-[10px] text-gray-400 mt-1">Enter to send · Shift+Enter for a new line</p>
    </div>
  );
}
