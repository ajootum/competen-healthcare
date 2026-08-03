"use client";

import { useState } from "react";

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function Reply({ threadId }: { threadId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");

  async function post() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/v1/practice/threads/${threadId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? data?.error ?? "That did not work.");
      setBusy(false); return;
    }
    window.location.reload();
  }

  return (
    <form className="mt-3 flex flex-col gap-2" onSubmit={e => { e.preventDefault(); post(); }}>
      {error && <p className="rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}
      <textarea required rows={3} placeholder="Reply..." value={body} onChange={e => setBody(e.target.value)} className={`${input} resize-y`} />
      <button type="submit" disabled={busy || !body.trim()}
        className="self-start rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
        Post
      </button>
    </form>
  );
}
