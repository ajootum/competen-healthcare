"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Approval = {
  id: string;
  framework_name: string | null;
  submitted_by_name: string | null;
  submitted_at: string;
};

export default function ApprovalActions({ approval }: { approval: Approval }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openModal(d: "approve" | "reject") {
    setDecision(d); setComment(""); setError(""); setOpen(true);
  }

  async function submit() {
    if (decision === "reject" && !comment.trim()) {
      setError("A comment is required when rejecting."); return;
    }
    setSaving(true); setError("");
    const res = await fetch("/api/content/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: approval.id, decision, comment: comment.trim() || null }),
    });
    setSaving(false);
    if (res.ok) { setOpen(false); router.refresh(); }
    else {
      const d = await res.json();
      setError(d.error ?? "Failed");
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button onClick={() => openModal("approve")}
          className="px-3 py-1.5 bg-[var(--cmp-color-success)] text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-colors">
          Approve
        </button>
        <button onClick={() => openModal("reject")}
          className="px-3 py-1.5 border border-[var(--cmp-color-critical)] text-[var(--cmp-text-critical)] text-xs font-semibold rounded-lg hover:bg-[var(--cmp-surface-critical)] transition-colors">
          Reject
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">
                {decision === "approve" ? "✅ Approve Content" : "❌ Reject Content"}
              </h2>
              <p className="text-sm text-gray-400 mt-0.5">{approval.framework_name}</p>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-500">
                Submitted by <span className="font-semibold text-gray-700">{approval.submitted_by_name ?? "Unknown"}</span> on{" "}
                {new Date(approval.submitted_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 block">
                  {decision === "reject" ? "Reason for rejection *" : "Comment (optional)"}
                </label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  rows={3}
                  placeholder={decision === "reject" ? "Explain what needs to be changed…" : "Optional feedback for the submitter…"}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                />
              </div>

              {decision === "approve" && (
                <div className="bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)] rounded-lg px-3 py-2.5 text-xs text-[var(--cmp-text-success)]">
                  Approving will move this framework to <strong>Approved</strong> status. The platform admin can then publish it.
                </div>
              )}
              {decision === "reject" && (
                <div className="bg-[var(--cmp-surface-critical)] border border-[var(--cmp-color-critical)] rounded-lg px-3 py-2.5 text-xs text-[var(--cmp-text-critical)]">
                  Rejecting will return this framework to <strong>Draft</strong> status for revision.
                </div>
              )}

              {error && <p className="text-xs text-red-500 bg-[var(--cmp-surface-critical)] rounded-lg px-3 py-2">{error}</p>}

              <div className="flex gap-3">
                <button onClick={() => setOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={submit} disabled={saving}
                  className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 transition-colors ${
                    decision === "approve" ? "bg-[var(--cmp-color-success)] hover:bg-green-700" : "bg-[var(--cmp-color-critical)] hover:bg-[var(--cmp-color-critical)]"
                  }`}>
                  {saving ? "Saving…" : decision === "approve" ? "Approve" : "Reject"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
