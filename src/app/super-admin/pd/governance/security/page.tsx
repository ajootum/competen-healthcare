import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadSecurityPosture } from "@/lib/hq/gov-security-posture";
import { Explain, Cite } from "../../_components/evidence";

// CPR-PD-010 §8 — SECURITY GOVERNANCE.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ §8: "DO NOT TURN THIS PAGE INTO A SOC." So this is a review surface with postures and owners, not a
// vulnerability feed. Live detection belongs to Product Health, and remediation to Product Operations.
//
// ⚠ AND §8 RESTRICTS SENSITIVE DETAIL TO AUTHORISED SECURITY ROLES, which shapes what is counted rather
// than only how it is labelled. "209 tables rely on application-layer guards" is a governance posture.
// "Here are the 209" is a map of where to look. The specific names belong in the restricted-detail
// store behind their own capability — not in a payload this overview, search, exports and payload logs
// would all carry.

export const dynamic = "force-dynamic";

const DOMAIN_LABEL: Record<string, string> = {
  authentication: "Authentication", authorization: "Authorization", encryption: "Encryption",
  secrets: "Secrets", session_management: "Session management", tenancy_isolation: "Tenancy isolation",
  auditability: "Auditability", backup_continuity: "Backups and continuity",
  third_party: "Third-party dependencies",
};

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();
  const reviews = await admin.from("gov_security_review")
    .select("review_id, reference, domain, title, posture, reviewed_by, reviewed_at, next_review_on, has_restricted_detail")
    .limit(200);
  const posture = loadSecurityPosture();

  const reviewed = new Map<string, Record<string, unknown>>();
  for (const r of (reviews.data ?? []) as Record<string, unknown>[]) reviewed.set(String(r.domain), r);

  return (
    <div className="flex flex-col gap-4">
      <header className="mb-1 border-b border-gray-200 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Governance &amp; Risk</p>
        <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-gray-900">Security Governance</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-600">
          Product security posture, assurance and significant security governance — reviewed, not monitored.
        </p>
      </header>

      {/* ── §8's nine review domains ─────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">The nine review domains (§8)</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          A review is an assurance activity with an owner, a date and a posture. None has been recorded.
        </p>
        {reviews.error ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The security review store could not be read. That is not zero reviews.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(DOMAIN_LABEL).map(([code, label]) => {
              const r = reviewed.get(code);
              return (
                <li key={code} className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[12px] font-semibold text-gray-900">{label}</p>
                  <p className={`mt-0.5 text-[11.5px] ${r ? "text-gray-700" : "font-semibold text-gray-500"}`}>
                    {r ? String(r.posture) : "Not assessed"}
                  </p>
                  {r?.reviewed_by ? (
                    <p className="mt-0.5 text-[11px] text-gray-500">{String(r.reviewed_by)}</p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-gray-500">No review recorded</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── what is checkable from source ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <h2 className="text-[13px] font-bold text-amber-900">What is checkable from the product itself</h2>
        {posture === null ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The product source could not be read from this environment. Unavailable rather than empty.
          </p>
        ) : (
          <>
            <p className="mt-1 max-w-4xl text-[12px] leading-relaxed text-gray-800">
              {posture.derivable} of §8&apos;s {posture.total} domains have something derivable from this
              repository. The rest are assurance activities — a rehearsal, an examination, a review —
              and no amount of reading the code produces one.
            </p>

            <ul className="mt-3 flex flex-col gap-2">
              {posture.facts.filter(f => f.value !== null).map(f => (
                <li key={f.domain} className="rounded-lg border border-amber-200 bg-white p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[12.5px] font-semibold text-gray-900">{f.label}</p>
                    <p className="text-[18px] font-bold leading-none tabular-nums text-gray-900">{f.value}</p>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-700">{f.reading}</p>
                </li>
              ))}
            </ul>

            <Explain summary="Why the tenancy-isolation figure is a posture and not a finding">
              Row-level security enabled with no policy denies anonymous and authenticated access
              outright — it is not an open door. What it means is that the service role, which bypasses
              row-level security entirely, is the path everything takes, so isolation between practices
              rests on application-layer guards rather than on the database. That is a legitimate design
              and it is also a single layer. Whether one layer is enough here is the judgement §8 asks
              this domain to make, and nobody has made it.
              <Cite>alter table … enable row level security appears on 209 Practice-plane tables; create policy appears on none of them</Cite>
            </Explain>

            <div className="mt-3 border-t border-amber-200 pt-2">
              <p className="text-[11px] font-semibold text-gray-700">Domains with nothing derivable</p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {posture.facts.filter(f => f.value === null).map(f => (
                  <li key={f.domain} className="text-[11.5px] leading-relaxed text-gray-600">
                    <span className="font-semibold text-gray-800">{f.label}</span> — {f.absent}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      {/* ── the restriction, demonstrated ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">What this page deliberately does not list (§8, §19)</h2>
        <p className="mt-2 max-w-4xl text-[12px] leading-relaxed text-gray-700">
          The counts above are posture. The specific tables behind them are not shown here, and neither
          are secret names or locations. §8 restricts sensitive detail to authorised security roles, and
          §19 requires restricted records to stay restricted <em>in search, notifications, exports and
          cross-module links</em> — which a flag on a row cannot deliver, because by the time anything
          reads the flag the payload has already been selected and logged.
        </p>
        <Explain summary="Where that detail lives instead">
          In its own table, behind its own capability, so a default read of a security review physically
          cannot return it. The review row carries a pointer saying whether there is detail to go and
          find — which is a flag doing the job a flag can actually do.
          <Cite>gov_security_restricted_detail is a separate table; the review row holds only has_restricted_detail</Cite>
        </Explain>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Where detection lives (§8, §1)</h2>
        <p className="mt-2 max-w-4xl text-[12px] leading-relaxed text-gray-700">
          §8 is explicit: do not turn this page into a security operations centre. Live signals are read
          in{" "}
          <Link href="/super-admin/pd/health" className="font-semibold text-teal-700 hover:underline">
            Product Health
          </Link>
          , response is coordinated in{" "}
          <Link href="/super-admin/pd/support" className="font-semibold text-teal-700 hover:underline">
            Support &amp; Incidents
          </Link>
          , and this module keeps the assurance question: has somebody examined this, when, and what did
          they conclude.
        </p>
      </section>
    </div>
  );
}
