"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { primaryBtn, secondaryBtn } from "@/app/individual/_components/chrome";
import { productTheme } from "@/lib/design/tokens";

// The learner's controls (COMPETEN-LEARNING-01 S2-S3). Each posts to the person's own Learning API. The server
// decides everything that matters -- access, scores, completion, certificates -- so these only send and report.

const ACCENT = productTheme.individual.accent;
const field = "w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-[14.5px] text-gray-900 focus-visible:outline-2 focus-visible:outline-gray-900";

function Note({ ok, text }: { ok: boolean; text: string }) {
  return <p role={ok ? "status" : "alert"} className={`rounded-xl border px-3 py-2 text-[13.5px] ${ok ? "border-[var(--cmp-theme-border)] bg-[var(--cmp-theme-soft)] text-[var(--cmp-theme-ink)]" : "border-amber-300 bg-amber-50 text-amber-950"}`}>{text}</p>;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/individual/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, j };
}

export function EnrolButton({ offeringId, label = "Enrol" }: { offeringId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button type="button" className={primaryBtn} style={{ background: ACCENT }} disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const { ok, j } = await post({ action: "enrol", offeringId });
        setBusy(false);
        if (!ok) { setErr(j?.error ?? "You could not be enrolled just now."); return; }
        router.push(`/individual/learning/record/${j.recordId}`);
      }}>{label}</button>
      {err && <Note ok={false} text={err} />}
    </div>
  );
}

export function BuyButton({ priceId, label }: { priceId: string; label: string }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button type="button" className={primaryBtn} style={{ background: ACCENT }} disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try {
          const res = await fetch("/api/individual/learning/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priceId }) });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j?.link) { setErr(j?.error?.message ?? "The checkout could not be started. Nothing was charged."); return; }
          window.location.assign(j.link);
        } finally { setBusy(false); }
      }}>{label}</button>
      {err && <Note ok={false} text={err} />}
    </div>
  );
}

export function LessonDone({ recordId, activityKey, nextHref }: { recordId: string; activityKey: string; nextHref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button type="button" className={primaryBtn} style={{ background: ACCENT }} disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const { ok, j } = await post({ action: "complete", recordId, activityKey });
        setBusy(false);
        if (!ok) { setErr(j?.error ?? "Your progress could not be saved just now."); return; }
        router.push(j?.completed ? `${nextHref.split("?")[0]}?done=1` : nextHref); router.refresh();
      }}>Mark as done and continue</button>
      {err && <Note ok={false} text={err} />}
    </div>
  );
}

export function CheckForm({ recordId, activityKey, questions }: { recordId: string; activityKey: string; questions: { id: string; prompt: string; options: { id: string; text: string }[] }[] }) {
  const router = useRouter();
  const [ans, setAns] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false), [res, setRes] = useState<any | null>(null), [err, setErr] = useState<string | null>(null);
  const toggle = (q: string, o: string) => setAns(a => ({ ...a, [q]: (a[q] ?? []).includes(o) ? (a[q] ?? []).filter(x => x !== o) : [...(a[q] ?? []), o] }));
  return (
    <form className="space-y-5" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setErr(null);
      const { ok, j } = await post({ action: "answer", recordId, activityKey, answers: ans });
      setBusy(false);
      if (!ok) { setErr(j?.error ?? "Your answers could not be saved just now."); return; }
      setRes(j); router.refresh();
    }}>
      {questions.map((q, i) => {
        const fb = res?.feedback?.find((f: any) => f.id === q.id);
        return (
          <fieldset key={q.id} className="space-y-2">
            <legend className="text-[15px] font-semibold text-gray-900">{i + 1}. {q.prompt}</legend>
            {q.options.map(o => (
              <label key={o.id} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 text-[14.5px] text-gray-800">
                <input type="checkbox" checked={(ans[q.id] ?? []).includes(o.id)} onChange={() => toggle(q.id, o.id)} disabled={!!res?.passed} /> {o.text}
              </label>))}
            {fb && <p className={`text-[13.5px] ${fb.correct ? "text-[var(--cmp-theme-ink)]" : "text-amber-900"}`}>{fb.correct ? "Correct." : "Not correct."}{fb.rationale ? ` ${fb.rationale}` : ""}</p>}
          </fieldset>);
      })}
      {res && <Note ok={res.passed} text={res.passed ? `Passed: ${res.score} of ${res.max}.${res.completed ? " You have completed the course." : ""}` : `${res.score} of ${res.max}. ${res.attemptsLeft ? `You have ${res.attemptsLeft} attempt${res.attemptsLeft === 1 ? "" : "s"} left.` : "No attempts are left."}`} />}
      {err && <Note ok={false} text={err} />}
      {!res?.passed && <button type="submit" className={primaryBtn} style={{ background: ACCENT }} disabled={busy}>Submit answers</button>}
    </form>
  );
}

export function ExternalCompleteForm({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setErr(null);
      const fd = new FormData(e.currentTarget); fd.set("recordId", recordId);
      const res = await fetch("/api/individual/learning/external", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setErr(j?.error ?? "Your completion could not be recorded just now."); return; }
      router.refresh();
    }}>
      <label className="block text-[14px] font-semibold text-gray-800">The date you completed it<input type="date" name="completedOn" required className={`${field} mt-1`} /></label>
      <label className="block text-[14px] font-semibold text-gray-800">Hours (optional)<input name="hours" inputMode="decimal" className={`${field} mt-1`} /></label>
      <label className="block text-[14px] font-semibold text-gray-800">What you learned (optional)<textarea name="reflection" rows={4} className={`${field} mt-1`} /></label>
      <label className="block text-[14px] font-semibold text-gray-800">The provider&apos;s certificate (optional: PDF or image, up to 4 MB)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="mt-1 block text-[14px]" /></label>
      <p className="text-[13px] text-gray-600">This is recorded as self-declared, or self-declared with a document attached. Competen does not check it with the provider, so it is never shown as verified.</p>
      {err && <Note ok={false} text={err} />}
      <button type="submit" className={primaryBtn} style={{ background: ACCENT }} disabled={busy}>Record my completion</button>
    </form>
  );
}

export function WithdrawButton({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button type="button" className={secondaryBtn} disabled={busy} onClick={async () => {
        if (!window.confirm("Withdraw from this course? Your record stays, marked as withdrawn.")) return;
        setBusy(true); const { ok, j } = await post({ action: "withdraw", recordId }); setBusy(false);
        if (!ok) { setErr(j?.error ?? "That could not be done just now."); return; }
        router.refresh();
      }}>Withdraw</button>
      {err && <Note ok={false} text={err} />}
    </div>
  );
}
