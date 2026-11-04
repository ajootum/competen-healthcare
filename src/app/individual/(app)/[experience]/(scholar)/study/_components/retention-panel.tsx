import Link from "next/link";
import { RETRIEVAL_NOTE, retrievalLine } from "@/lib/individual/scholar/retrieval-schedule";
import { TRANSFER_NOTE } from "@/lib/individual/scholar/transfer";
import type { RetentionView } from "@/lib/individual/scholar/retention-data";
import { TransferOffer } from "./transfer-offer";
import { focusRing } from "../../../../../_components/chrome";

// SALE-2026-11 R2 (SALE-08 / SALE-09 / SALE-10) -- on Revise: what is due for retrieval, where a short prerequisite review is justified,
// and topics ready for a transfer check. Presentational: every word and reason comes from retrieval.ts, prerequisite.ts and transfer.ts
// (pure, no AI). Each block shows only while its HQ policy key is on. A suggestion the learner chooses: nothing is added to their plan.

const SHOWN = 6;
const h2 = "text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500";
const card = "rounded-2xl border border-gray-200 bg-white";

export function RetentionPanel({ v, accent }: { v: RetentionView; accent: string }) {
  const s = v.schedule;
  if (!s && !v.prerequisites && !v.transfer) return null;
  return (
    <div className="space-y-6" data-retention>
      {s && (
        <section aria-labelledby="retrieval-h" data-retrieval>
          <h2 id="retrieval-h" className={h2}>Due for retrieval</h2>
          <p className="mt-1 text-[13px] text-gray-600">{RETRIEVAL_NOTE} {s.capacity.basis}</p>
          {s.due.length === 0 ? (
            <p className={`mt-2 ${card} p-4 text-[14px] text-gray-700`} data-retrieval-empty>
              Nothing is due today.{s.upcoming.length ? ` Next: ${s.upcoming[0].label} on ${s.upcoming[0].dueOn}.` : s.notAssessed ? " Topics you have met but not yet answered questions on are not scheduled." : ""}
            </p>
          ) : (
            <ul className={`mt-2 divide-y divide-gray-100 ${card}`} aria-label="Due for retrieval">
              {s.due.slice(0, SHOWN).map(i => (
                <li key={i.topicKey} className="px-4 py-3" data-retrieval-topic={i.topicKey} data-retrieval-rules={i.rules.join(" ")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 break-words text-[14px] font-semibold text-gray-900">{i.label}</span>
                    <span className="text-[12px] font-semibold text-gray-600">{retrievalLine(i, s.today)} · about {i.minutes} min</span>
                  </div>
                  <p className="mt-1 text-[13px] text-gray-800">{i.reasons[0]}</p>
                  {i.reasons.length > 1 && (
                    <details className="mt-1" suppressHydrationWarning>
                      <summary className={`cursor-pointer text-[12.5px] font-semibold text-gray-700 pointer-coarse:py-2 ${focusRing}`}>Why now</summary>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-700">{i.reasons.slice(1).map((r, k) => <li key={k}>{r}</li>)}<li>Rules {i.rules.join(", ")}.</li></ul>
                    </details>
                  )}
                  <Link href={i.action.href} className={`mt-1.5 inline-flex min-h-[44px] items-center text-[14px] font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`} style={{ color: accent }}>{i.action.label}</Link>
                </li>
              ))}
            </ul>
          )}
          {(s.due.length > SHOWN || s.upcoming.length > 0) && (
            <p className="mt-1.5 text-[12.5px] text-gray-600">
              {s.due.length > SHOWN ? `And ${s.due.length - SHOWN} more due. ` : ""}{s.upcoming.length ? `${s.upcoming.length} coming up in the next 7 days.` : ""}
            </p>
          )}
        </section>
      )}
      {v.prerequisites && v.prerequisites.length > 0 && (
        <section aria-labelledby="prereq-h" data-prerequisites>
          <h2 id="prereq-h" className={h2}>A foundation to review first</h2>
          <p className="mt-1 text-[13px] text-gray-600">Only where several different questions were missed and your framework lists a prerequisite your answers do not show yet. Most difficulty is not a missing foundation.</p>
          <ul className={`mt-2 divide-y divide-gray-100 ${card}`}>
            {v.prerequisites.slice(0, 3).map(p => (
              <li key={p.topicKey} className="px-4 py-3" data-prerequisite-topic={p.topicKey} data-prerequisite={p.prerequisite.id}>
                <p className="text-[14px] font-semibold text-gray-900">{p.topicLabel}: review &ldquo;{p.prerequisite.title}&rdquo; first</p>
                <p className="mt-1 text-[13px] text-gray-800">{p.reason}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-700">{p.evidence.map((e, k) => <li key={k}>{e}</li>)}</ul>
                <Link href={p.href} className={`mt-1.5 inline-flex min-h-[44px] items-center text-[14px] font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`} style={{ color: accent }}>
                  {p.section ? `Review your notes: ${p.section.label}` : `Learn "${p.prerequisite.title}"`}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {v.transfer && v.transfer.length > 0 && (
        <section aria-labelledby="transfer-h" data-transfer>
          <h2 id="transfer-h" className={h2}>Use it in a new setting</h2>
          <p className="mt-1 text-[13px] text-gray-600">{TRANSFER_NOTE}</p>
          <ul className={`mt-2 divide-y divide-gray-100 ${card}`}>
            {v.transfer.slice(0, 3).map(t => (
              <li key={t.topic} className="px-4 py-3" data-transfer-topic={t.topic}>
                <p className="break-words text-[14px] font-semibold text-gray-900">{t.topic}</p>
                <p className="mt-1 text-[13px] text-gray-800">{t.reason}</p>
                <TransferOffer topic={t.topic} accent={accent} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
