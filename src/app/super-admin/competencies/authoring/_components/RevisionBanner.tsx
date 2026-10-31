"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReviewButton } from "./ReviewDialog";

// FRAMEWORK-DESIGN-STUDIO-02 S6 (owner ruling D2): the open REVISION DRAFT of a published framework. Every content edit in
// the Studio is already saved to it by the server; learners and assessors keep reading the published version. This banner
// says so, counts what the revision changes, and offers the four things a revision needs: compare it with the published
// version, preview it as a pack, put it forward for clinical review (the existing review flow, proposed content), and
// discard it. Publication needs an independent publisher and stays on Framework publication. Nothing here approves or publishes.

const btn = "inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const tone = `${btn} border-amber-400 bg-white text-amber-950 hover:bg-amber-100`;
const AUTHORING = "/api/hq/competency/authoring";
const PUBLICATION = "/super-admin/competencies/publication";

export function RevisionBanner({ frameworkId, summary, updatedAt, by, editable, hasCompetencies }: {
  frameworkId: string; summary: string; updatedAt: string | null; by: string | null; editable: boolean; hasCompetencies: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const when = updatedAt ? new Date(updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" }) : null;

  async function discard() {
    if (!window.confirm("Discard the revision draft? Every change in it is dropped. The published framework is not changed.")) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(AUTHORING, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discard_revision", frameworkId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "The revision draft could not be discarded. Nothing has changed." }); return; }
      setMsg({ ok: true, text: "The revision draft was discarded." }); router.refresh();
    } catch { setMsg({ ok: false, text: "The revision draft could not be discarded. Check your connection." }); } finally { setBusy(false); }
  }

  return (
    <section aria-label="Revision draft" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="text-[14px] font-bold">Revision draft — not visible to learners or assessors until reviewed and published</p>
      <p className="mt-1 text-[13px]" role="status">{summary}.{when || by ? ` Last saved${when ? ` ${when}` : ""}${by ? `, opened by ${by}` : ""}.` : ""}</p>
      <p className="mt-1 text-[13px]">Edit as usual: every content change is saved to this draft, not to the published framework. Put it forward for clinical review when it is ready. Publishing needs an independent publisher: once every changed competency is clinically approved, put the revision forward for publication from <Link href="?tab=overview" className="font-semibold underline">Overview &amp; governance</Link>, and the publisher decides on <Link href={PUBLICATION} className="font-semibold underline">Framework publication</Link>. Put it forward again after any later edit.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="?tab=compare" className={tone}>Compare with published</Link>
        <Link href="?view=pack&revision=1" className={tone}>Preview revision pack</Link>
        <ReviewButton frameworkId={frameworkId} scope={{ kind: "framework" }} revision label="Put forward for clinical review" className={tone} disabled={!editable || !hasCompetencies} />
        <button type="button" onClick={discard} disabled={busy || !editable} className={tone}>Discard revision</button>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-[12.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
    </section>
  );
}

/** A published framework with no open revision: what editing it does. Shown calmly: nothing is wrong. */
export function RevisionIntro({ ready }: { ready: boolean }) {
  return (
    <p role="note" className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-[12.5px] font-medium text-gray-800">
      {ready
        ? "This framework is published. Your first content change opens a revision draft: learners and assessors keep the published version until the revision is clinically reviewed and published by an independent publisher."
        : "Revision drafts are not set up on this environment yet (migration 770), so a published framework is not changed here. Nothing can be edited until they are."}
    </p>
  );
}

/** Put one revision competency's PROPOSED content forward for clinical review (the existing review flow, revision: true). */
export function SubmitRevisionReview({ competencyId, frameworkId }: { competencyId: string; frameworkId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(AUTHORING, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit_review", competencyId, frameworkId, revision: true }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be put forward. Nothing has changed." }); return; }
      setMsg({ ok: true, text: "The revision's version of this competency was put forward for independent clinical review." }); router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be put forward. Check your connection." }); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]" disabled={busy} onClick={() => void go()}>Put forward the revision for clinical review</button>
      {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[12.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</span>}
    </span>
  );
}
