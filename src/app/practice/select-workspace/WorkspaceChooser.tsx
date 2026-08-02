"use client";

import { useState } from "react";

// Activation goes through the API so the server validates membership and sets the context cookie
// (IAM-001 s12 switchWorkspace); the client never writes the cookie itself. A failed activation leaves
// the previous context untouched (SHELL-001 s11.1).
export default function WorkspaceChooser({ workspaces }: {
  workspaces: { id: string; name: string; status: string }[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function activate(id: string) {
    setBusy(id); setError("");
    const res = await fetch(`/api/v1/practice/workspaces/${id}/activate`, { method: "POST" });
    if (!res.ok) { setError("Could not open that workspace."); setBusy(null); return; }
    window.location.assign("/practice/home");
  }

  return (
    <div className="flex flex-col gap-2">
      {workspaces.map(w => (
        <button key={w.id} type="button" onClick={() => activate(w.id)} disabled={busy !== null}
          className="rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-[#2563EB] hover:shadow-sm transition disabled:opacity-60">
          <p className="text-[14px] font-bold text-gray-900">{w.name}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Practice workspace · {w.status}</p>
        </button>
      ))}
      {error && <p className="text-xs text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] rounded-lg px-3 py-2">{error}</p>}
    </div>
  );
}
