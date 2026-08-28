"use client";

import { useState } from "react";

// Start a conversation. The engine refuses a subject with no body, and the form mirrors that rather
// than letting the refusal arrive as a red banner after the click.

const input = "w-full rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function NewThread() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  async function create() {
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/threads", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? data?.error ?? "That did not work.");
      setBusy(false); return;
    }
    window.location.href = `/practice/messages/${data.thread.id}`;
  }

  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
        {open ? "Cancel" : "Start a conversation"}
      </button>
      {open && (
        <form className="mt-3 flex flex-col gap-2" onSubmit={e => { e.preventDefault(); create(); }}>
          {error && <p className="rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}
          <input required placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} className={input} />
          <textarea required rows={3} placeholder="Say the thing — a subject alone is not a message."
            value={body} onChange={e => setBody(e.target.value)} className={`${input} resize-y`} />
          <button type="submit" disabled={busy || !subject.trim() || !body.trim()}
            className="self-start rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
            Post
          </button>
        </form>
      )}
    </section>
  );
}
