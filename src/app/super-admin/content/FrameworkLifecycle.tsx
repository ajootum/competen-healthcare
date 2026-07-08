"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "draft" | "in_review" | "approved" | "published" | "archived";
type Action = "submit_review" | "revert" | "publish" | "archive";

const ACTIONS: Partial<Record<Status, { action: Action; label: string; cls: string }[]>> = {
  draft:     [{ action: "submit_review", label: "Submit for Review", cls: "bg-amber-500 hover:bg-amber-600 text-white" }],
  in_review: [{ action: "revert",        label: "Revert to Draft",   cls: "border border-gray-200 text-gray-600 hover:bg-gray-50" }],
  approved:  [
    { action: "publish", label: "Publish",      cls: "bg-green-600 hover:bg-green-700 text-white" },
    { action: "revert",  label: "Revert",       cls: "border border-gray-200 text-gray-500 hover:bg-gray-50" },
  ],
  published: [{ action: "archive", label: "Archive", cls: "border border-gray-200 text-gray-500 hover:bg-gray-50" }],
  archived:  [{ action: "publish", label: "Restore", cls: "border border-gray-200 text-gray-600 hover:bg-gray-50" }],
};

const STATUS_BADGE: Record<Status, { label: string; cls: string }> = {
  draft:     { label: "Draft",      cls: "text-gray-500 bg-gray-100" },
  in_review: { label: "In Review",  cls: "text-amber-700 bg-amber-50 border border-amber-200" },
  approved:  { label: "Approved",   cls: "text-blue-700 bg-blue-50 border border-blue-200" },
  published: { label: "Published",  cls: "text-green-700 bg-green-50" },
  archived:  { label: "Archived",   cls: "text-red-500 bg-red-50" },
};

const ACTION_RESULT: Record<Action, Status> = {
  submit_review: "in_review",
  revert:        "draft",
  publish:       "published",
  archive:       "archived",
};

export default function FrameworkLifecycle({
  frameworkId, initialStatus,
}: {
  frameworkId: string;
  initialStatus: string | null | undefined;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>((initialStatus ?? "published") as Status);
  const [loading, setLoading] = useState<Action | null>(null);
  const [error, setError] = useState("");

  async function trigger(action: Action) {
    setLoading(action); setError("");
    const res = await fetch("/api/content/lifecycle", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frameworkId, action }),
    });
    setLoading(null);
    if (res.ok) {
      setStatus(ACTION_RESULT[action]);
      router.refresh();
    } else {
      const d = await res.json();
      setError(d.error ?? "Failed");
    }
  }

  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.published;
  const buttons = ACTIONS[status] ?? [];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badge.cls}`}>
        {badge.label}
      </span>
      {buttons.map(b => (
        <button key={b.action} onClick={() => trigger(b.action)} disabled={!!loading}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 ${b.cls}`}>
          {loading === b.action ? "…" : b.label}
        </button>
      ))}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}
