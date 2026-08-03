"use client";

import { useState } from "react";

// The redemption form. Uppercases as you type, because the code is printed in uppercase and somebody
// reading it off a sticky note should not fail on case.

export default function JoinForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ workspaceName: string; roleCode: string } | null>(null);

  async function join() {
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/team/join", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? data?.error ?? "That did not work.");
      setBusy(false); return;
    }
    setJoined(data.joined);
    setBusy(false);
  }

  if (joined) {
    return (
      <div className="mt-6 rounded-xl border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-success)]">
          You have joined {joined.workspaceName}.
        </p>
        <p className="mt-1 text-[12px] text-gray-700">
          As a {joined.roleCode.replace(/_/g, " ")}. What you can see and do comes from that role.
        </p>
        {/* A FULL NAVIGATION, NOT A ROUTER TRANSITION. This person was not a member of anything when
            the page loaded, so the router's cache may hold a /practice/home response from before the
            membership existed -- and the shell's guards need re-evaluating against it from scratch.
            location.assign rather than <Link> makes that deliberate rather than a lint exception. */}
        <button type="button" onClick={() => window.location.assign("/practice/home")}
          className="mt-3 inline-block rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
          Open the practice
        </button>
      </div>
    );
  }

  return (
    <form className="mt-6 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); join(); }}>
      {error && (
        <p className="rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>
      )}
      <input
        autoFocus
        required
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
        placeholder="XXXXX-XXXXX"
        aria-label="Invitation code"
        className="w-full rounded-lg border border-gray-300 px-3 py-3 text-center font-mono text-lg tracking-widest outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10"
      />
      <button type="submit" disabled={busy || !code.trim()}
        className="rounded-lg bg-[var(--cp-primary)] px-4 py-3 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
        {busy ? "Checking…" : "Join"}
      </button>
    </form>
  );
}
