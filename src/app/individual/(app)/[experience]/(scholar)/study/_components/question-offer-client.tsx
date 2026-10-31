"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// OFFER A QUESTION TO THE COMPETEN LIBRARY -- SQIE-LIBRARY-EXPANSION-01 (owner GO 31 Oct 2026, item F), the Scholar side.
// The learner's separate permission (with the attestation text they read) and, once granted, an offer of ONE question at a
// time. What is screened and decided is the server's (src/lib/question-offers/offers.ts and migration 802): this panel only
// asks. Switched off (scholar_question_offering), nothing new can be granted or offered, but withdrawing is always offered.
// One column below md (the CPR-MOB-001 single md edge); touch targets grow on coarse pointers.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

async function call(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

const STATUS: Record<string, string> = { offered: "Offered, waiting for an educator", taken: "Taken in as a draft by an educator", promoted: "Published, after educator and clinical review", declined: "Declined by an educator", withdrawn: "Withdrawn" };

export type OfferableQuestion = { id: string; stem: string; formatLabel: string; hasQuote: boolean };
export type MyOfferView = { id: string; questionId: string | null; status: string; formatLabel: string };

export function QuestionOfferPanel(props: {
  /** Whether new permissions and offers are allowed (scholar_question_offering). Off: only withdrawing is offered. */
  offering: boolean; available: boolean; granted: boolean; attestationVersion: string;
  text: { own_notes: string; licensed_to_share: string; terms: string };
  questions: OfferableQuestion[]; offers: MyOfferView[];
}) {
  const router = useRouter();
  const [attestation, setAttestation] = useState<"own_notes" | "licensed_to_share" | "">("");
  const [quote, setQuote] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  if (!props.available) return null;
  const live = props.offers.filter(o => o.status === "offered" || o.status === "declined");
  if (!props.offering && !props.granted && !live.length) return null;
  const byQuestion = new Map(props.offers.filter(o => o.questionId && o.status !== "withdrawn").map(o => [o.questionId!, o]));
  const done = (ok: boolean, good: string, json: Record<string, unknown>) => { setBusy(""); setMsg(ok ? good : String(json.error ?? "That could not be done.")); if (ok) router.refresh(); };

  async function grant() {
    setBusy("grant"); setMsg("");
    const r = await call("/api/individual/scholar/question-offering", { attestation, attestationVersion: props.attestationVersion });
    done(r.ok, "Permission recorded. You can now offer a question, one at a time.", r.json);
  }
  async function revoke() {
    setBusy("revoke"); setMsg("");
    const r = await call("/api/individual/scholar/question-offering", undefined, "DELETE");
    done(r.ok, `Permission withdrawn. ${Number(r.json.withdrawn ?? 0)} offer(s) not yet taken in were removed.`, r.json);
  }
  async function offer(q: OfferableQuestion) {
    setBusy(q.id); setMsg("");
    const withQuote = quote[q.id] === true;
    const r = await call(`/api/individual/scholar/questions/${q.id}/offer`, { includeQuote: withQuote, rightsConfirmed: withQuote });
    done(r.ok, "Offered. An educator may take it in as a draft; only a version an independent clinical reviewer approves is ever published, and you are never named.", r.json);
  }
  async function withdraw(o: MyOfferView) {
    setBusy(`w${o.id}`); setMsg("");
    const r = await call(`/api/individual/scholar/questions/${o.questionId ?? "x"}/offer`, { offerId: o.id }, "DELETE");
    done(r.ok, "Withdrawn. Nothing of it was kept.", r.json);
  }

  return (
    <section aria-labelledby="qoffer-h" className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 id="qoffer-h" className="text-[15px] font-bold text-gray-900">Offer your questions to the Competen library</h2>
      <p className="text-[12.5px] text-gray-600">Optional, and separate from your AI help setting and from offering cases. Nothing is offered unless you choose a question. Offering never uses your AI allowance.</p>
      {!props.offering && <p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">Offering questions is switched off here. You can still withdraw a permission or an offer you made.</p>}
      {!props.granted ? (
        props.offering && (
          <div className="mt-3 space-y-2 text-[13.5px] text-gray-800">
            <p>{props.text.terms}</p>
            <fieldset><legend className="text-[13px] font-semibold">The notes my questions were written from are</legend>
              <label className="mt-1 flex items-start gap-2"><input type="radio" name="qattest" checked={attestation === "own_notes"} onChange={() => setAttestation("own_notes")} />{props.text.own_notes}</label>
              <label className="mt-1 flex items-start gap-2"><input type="radio" name="qattest" checked={attestation === "licensed_to_share"} onChange={() => setAttestation("licensed_to_share")} />{props.text.licensed_to_share}</label>
            </fieldset>
            <button type="button" className={ghost} disabled={!attestation || !!busy} onClick={grant}>Allow my chosen questions to be considered</button>
          </div>
        )
      ) : (
        <>
          {props.questions.length === 0 ? <p className="mt-2 text-[13.5px] text-gray-600">You have no practice questions of your own to offer yet.</p> : (
            <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
              {props.questions.map(q => { const o = byQuestion.get(q.id); return (
                <li key={q.id} className="flex flex-col gap-2 px-3 py-2 text-[14px] md:flex-row md:items-center md:justify-between">
                  <span className="min-w-0 flex-1"><span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-500">{q.formatLabel}</span><span className="block line-clamp-2">{q.stem}</span>
                    {o && <span className="block text-[12.5px] text-gray-600">{STATUS[o.status] ?? o.status}</span>}</span>
                  {o && (o.status === "offered" || o.status === "declined") ? <button type="button" className={ghost} disabled={!!busy} onClick={() => withdraw(o)}>{busy === `w${o.id}` ? "Withdrawing…" : "Withdraw"}</button>
                    : !o && props.offering ? (
                      <span className="flex flex-col gap-1 md:items-end">
                        {q.hasQuote && <label className="flex items-start gap-2 text-[12.5px] text-gray-700"><input type="checkbox" checked={quote[q.id] === true} onChange={e => setQuote(s => ({ ...s, [q.id]: e.target.checked }))} />Include the passage it quotes from my notes: I have the right to share it</label>}
                        <button type="button" className={ghost} disabled={!!busy} onClick={() => offer(q)}>{busy === q.id ? "Offering…" : "Offer to the Competen library"}</button>
                      </span>
                    ) : null}
                </li>
              ); })}
            </ul>
          )}
          <button type="button" className={`${ghost} mt-3`} disabled={!!busy} onClick={revoke}>Withdraw my permission</button>
        </>
      )}
      {!props.granted && live.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13.5px]">{live.map(o => (
          <li key={o.id} className="flex flex-wrap items-center gap-2">{o.formatLabel} · {STATUS[o.status] ?? o.status}<button type="button" className={ghost} disabled={!!busy} onClick={() => withdraw(o)}>Withdraw</button></li>
        ))}</ul>
      )}
      {msg && <p role="status" className="mt-2 text-[13px] text-gray-700">{msg}</p>}
    </section>
  );
}
