import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { GovHeader, Panel, EmptyOrUnreadable, Needs, Explain, Cite } from "../_components/gov-ui";

// CPR-PD-010 §13 — AUDIT & EVIDENCE.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ EVIDENCE GOES STALE BY THE PASSAGE OF TIME, AND STALE EVIDENCE EVIDENCES NOTHING. §22: "evidence
// stale — show stale/expired, do not treat control as evidenced." So there is no is-valid flag; validity
// is computed from the expiry date every time anybody looks, and the database refuses to let expired
// evidence close a finding. The derivation is a control rather than a label because of that second half.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();

  const [evidence, requests, findings] = await Promise.all([
    admin.from("gov_evidence_live")
      .select("evidence_id, reference, title, evidence_kind, owner_name, valid_until, is_current, is_expired, days_to_expiry, is_restricted")
      .limit(300),
    admin.from("gov_audit_request")
      .select("request_id, reference, title, requested_by, requester_org, state, due_on")
      .limit(200),
    admin.from("gov_audit_finding")
      .select("finding_id, reference, title, severity, state, owner_name, due_on, closing_evidence_id")
      .limit(200),
  ]);

  const ev = evidence.error ? null : (evidence.data as Record<string, unknown>[]);
  const rq = requests.error ? null : (requests.data as Record<string, unknown>[]);
  const fd = findings.error ? null : (findings.data as Record<string, unknown>[]);
  const expired = (ev ?? []).filter(e => e.is_expired === true).length;

  return (
    <div className="flex flex-col gap-4">
      <GovHeader
        title="Audit & Evidence"
        purpose="What proves the controls operate, who asked for it, and what the findings were."
      />

      <Panel
        title="The evidence index (§13)"
        note="An index of where evidence lives, never a copy of it — §13 asks for governed references rather than duplicated files."
      >
        <EmptyOrUnreadable
          rows={ev} what="evidence item"
          meaning="A measured zero. ⚠ It means nothing has been recorded as proving anything — not that the product is unevidenced in the ordinary sense. Its constraints and trails run every day; none of that is registered as evidence for a control that nobody has registered either."
        />
        {(ev ?? []).length > 0 && (
          <>
            {expired > 0 && (
              <p className="mb-2 rounded border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-2 py-1.5 text-[11.5px] font-semibold text-[var(--cmp-text-warning)]">
                ⚠ {expired} evidence item{expired === 1 ? " is" : "s are"} past validity. Stale evidence does not evidence anything.
              </p>
            )}
            <ul className="flex flex-col divide-y divide-gray-100">
              {(ev ?? []).map(e => (
                <li key={String(e.evidence_id)} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">
                      <span className="font-mono text-[11px] text-gray-500">{String(e.reference)}</span> {String(e.title)}
                    </p>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      e.is_expired
                        ? "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"
                        : e.is_current ? "border-teal-300 bg-teal-50 text-teal-800" : "border-gray-300 bg-gray-50 text-gray-700"}`}>
                      {e.is_expired ? "expired" : e.is_current ? "current" : "not current"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-gray-600">
                    {String(e.evidence_kind).replace(/_/g, " ")}
                    {e.owner_name ? ` · ${String(e.owner_name)}` : " · no owner"}
                    {e.valid_until ? ` · valid until ${String(e.valid_until)}` : " · no expiry set"}
                    {e.is_restricted ? " · restricted" : ""}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-3">
          <Explain summary="Why the four evidence kinds are kept apart">
            §20 requires system-generated evidence and human attestations to be distinguishable, and the
            distinction is not cosmetic: an export from a system of record and somebody&apos;s word about
            what they saw carry different weight and fail in different ways. Four kinds — system
            generated, document, attestation, external assurance — rather than a boolean, because
            &ldquo;not automated&rdquo; is not the same claim as &ldquo;attested&rdquo;.
            <Cite>gov_evidence.evidence_kind is a four-value vocabulary, not a flag</Cite>
          </Explain>
        </div>
      </Panel>

      <Panel title="Audit and review requests (§13)">
        <EmptyOrUnreadable
          rows={rq} what="audit request"
          meaning="Nobody has asked this product for evidence. A measured zero about requests, and it says nothing about whether the evidence would exist if somebody did."
        />
        {(rq ?? []).map(r => (
          <div key={String(r.request_id)} className="border-b border-gray-100 py-2 last:border-0">
            <p className="text-[12.5px] font-semibold text-gray-900">{String(r.title)}</p>
            <p className="mt-0.5 text-[11.5px] text-gray-600">
              {String(r.requester_org ?? r.requested_by)} · {String(r.state)}
              {r.due_on ? ` · due ${String(r.due_on)}` : ""}
            </p>
          </div>
        ))}
      </Panel>

      <Panel
        title="Findings (§13)"
        note="A finding is closed by evidence that the deficiency is gone, not by somebody marking it closed."
      >
        <EmptyOrUnreadable
          rows={fd} what="audit finding"
          meaning="No finding has been raised — which follows from nobody having audited anything, rather than from an audit having found nothing."
        />
        {(fd ?? []).map(f => (
          <div key={String(f.finding_id)} className="border-b border-gray-100 py-2 last:border-0">
            <p className="text-[12.5px] font-semibold text-gray-900">
              <span className="font-mono text-[11px] text-gray-500">{String(f.reference)}</span> {String(f.title)}
            </p>
            <p className="mt-0.5 text-[11.5px] text-gray-600">
              {String(f.severity)} · {String(f.state)}
              {f.owner_name ? ` · ${String(f.owner_name)}` : " · no owner"}
              {f.closing_evidence_id ? " · closed with evidence" : ""}
            </p>
          </div>
        ))}
        <div className="mt-3">
          <Explain summary="Why finding severity is not the incident severity scale">
            A control deficiency and a live outage are not comparable, and sharing SEV-1 to SEV-4 across
            both would invite exactly that comparison — a reader would rank an audit finding against an
            ongoing failure and act on the wrong one. Findings use minor, moderate, major and critical,
            deliberately not the vocabulary{" "}
            <Link href="/super-admin/pd/support" className="font-semibold text-teal-700 hover:underline">
              Support &amp; Incidents
            </Link>{" "}
            uses.
          </Explain>
        </div>
      </Panel>

      <Panel title="What §13 asks for that nothing here can supply">
        <Needs items={[
          { label: "The evidence itself", why: "§13 asks for governed references rather than duplicated files, so this is an index of where authoritative evidence lives. Somebody has to collect it and say where it is." },
          { label: "Validity periods", why: "How long a penetration test or an attestation remains good for. A judgement per kind of evidence, and the thing that makes staleness computable at all." },
          { label: "An auditor", why: "Findings arise from somebody examining something. Nothing on this page can be produced by the product looking at itself." },
        ]} />
      </Panel>
    </div>
  );
}
