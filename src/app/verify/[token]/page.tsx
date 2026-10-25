import { createAdminClient } from "@/lib/supabase/server";
import { loadFrameworkCurrency, assessCurrency, summariseCurrency } from "@/lib/competency/framework-currency";
import { loadOwnRecords, summariseOwn, OWN_KIND_LABEL, PROFESSION_NOT_RECORDED } from "@/lib/individual/professional/passport-records";
import { shareCarriesOwnRecords } from "@/lib/individual/professional/share";
import { EVIDENCE_LABEL } from "@/lib/individual/passport";
import { individualAppEnabled } from "@/lib/individual/gate";
import { loadStudyAchievements } from "@/lib/individual/scholar/store";
import { STUDY_ACHIEVEMENT, studyDetail } from "@/lib/individual/scholar/passport-items";
import { loadSharedProfile } from "@/lib/individual/professional/share-profile";
import { METHOD_LABEL, VERIFICATION_LABEL, isIndependentlyVerified } from "@/lib/individual/professional/profile-verification";
import { ITEM_LABEL } from "@/lib/individual/professional/profile-vocabulary";
import { loadIndividualPolicy } from "@/lib/individual/policy";

export const dynamic = "force-dynamic";

// COMP-023 PUBLIC passport verification page. NO auth — the unguessable token IS the access control.
// Renders ONLY a consented subset of the professional's OWN passport (verified/current achievements — never
// gaps, notes, patient data or anyone else's record), and only while the token is valid (not revoked/expired).
//
// COMPETEN-IND-007 s5. A link minted from Competen Professional ALSO carries the records the person added
// themselves -- and only such a link: its companion row in individual_professional_share (migration 373)
// is the consent. Those records are labelled with their evidence class and are never called verified, and
// the page stops calling itself a "Verified Passport" when it shows them. Every other link renders exactly
// as before.
/* eslint-disable @typescript-eslint/no-explicit-any */

const nameOf = (row: any) => { const fc = row?.framework_competencies; return (Array.isArray(fc) ? fc[0]?.name : fc?.name) ?? null; };
const CRED_LABEL: Record<string, string> = { professional_license: "Professional licence", academic_qualification: "Academic qualification", board_certification: "Board certification", specialty_certification: "Specialty certification", internal_certification: "Internal certification", external_certification: "External certification", cpd_certificate: "CPD certificate", instructor_certification: "Instructor certification", mandatory_training: "Mandatory training" };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function Shell({ children }: { children: any }) {
  return <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 flex items-center justify-center p-4"><div className="w-full max-w-2xl">{children}</div></div>;
}
function Invalid({ reason }: { reason: string }) {
  return <Shell><div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center"><div className="text-4xl mb-3">🔒</div><h1 className="text-lg font-bold text-gray-900">Verification link unavailable</h1><p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">{reason}</p><p className="text-[11px] text-gray-400 mt-6">Competen · Competency Passport Verification</p></div></Shell>;
}

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient() as any;

  const { data: share, error } = await admin.from("passport_share_tokens").select("id, nurse_id, scope, label, expires_at, consent, revoked, created_at, view_count").eq("token", token).maybeSingle();
  if (error || !share) return <Invalid reason="This verification link is invalid. Ask the professional to share a current link." />;
  if (share.revoked) return <Invalid reason="This verification link has been revoked by the professional." />;
  if (share.expires_at && new Date(share.expires_at) < new Date()) return <Invalid reason="This verification link has expired. Ask the professional for a new one." />;
  if (share.consent === false) return <Invalid reason="This verification link is no longer active." />;

  // Increment the view counter (fire-and-forget).
  admin.from("passport_share_tokens").update({ view_count: (share.view_count ?? 0) + 1 }).eq("id", share.id).then((r: any) => r, () => {});

  // ── Consented subset only ──
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, specialization, hospital_id").eq("id", share.nurse_id).maybeSingle();
  const today = new Date().toISOString().slice(0, 10);
  const { data: decRows } = await admin.from("competency_decisions").select("competency_id, outcome, expiry_date, created_at, framework_id, framework_version, framework_competencies(name)").eq("nurse_id", share.nurse_id).order("created_at", { ascending: false }).limit(3000);
  const latest = new Map<string, any>();
  (decRows ?? []).forEach((d: any) => { if (d.competency_id && !latest.has(d.competency_id)) latest.set(d.competency_id, d); });
  const current = [...latest.values()].filter(d => d.outcome === "competent" && (!d.expiry_date || d.expiry_date > today));

  // XWI P2-10b — this page tells a THIRD PARTY that these competencies are current. Of every surface in the
  // platform it is the one where an unqualified "current" does the most damage, because the reader has no
  // other source. Not-expired is only half the question; the other half is whether the standard has moved.
  const currency = await loadFrameworkCurrency(admin, current.map(d => d.framework_id));
  const verdicts = current.map(d => assessCurrency(d, currency));
  const currencySummary = summariseCurrency(verdicts);
  const { data: creds } = await admin.from("professional_credentials").select("title, issuing_body, credential_type, expiry_date").eq("nurse_id", share.nurse_id).eq("verified", true).eq("status", "active").order("issue_date", { ascending: false }).limit(50);
  const credentials = (creds ?? []) as any[];

  const roleLabel = (profile?.roles?.[0] ?? profile?.role ?? "Healthcare professional").replace(/_/g, " ");
  const full = share.scope === "full";
  const competencyNames = current.map(nameOf).filter(Boolean) as string[];

  // While the Individual release gate is off (src/lib/individual/gate.ts) Individual does not exist, so no
  // link shows its records -- every link renders as the estate one.
  const carriesOwn = (await individualAppEnabled(admin)) && await shareCarriesOwnRecords(admin, share.id, share.nurse_id);
  const own = carriesOwn ? await loadOwnRecords(admin, share.nurse_id) : null;
  const ownSummary = own ? summariseOwn(own) : null;
  // The Competen Scholar achievements the person chose to show (migration 375), read NOW, on every view:
  // taking one off the Passport takes it off this link too, however long ago the link was shared. Only on
  // a link that carries the person's own records -- an organisation-minted link shows none of them.
  const study = carriesOwn ? await loadStudyAchievements(admin, share.nurse_id) : null;
  // COMPETEN-PROFESSIONAL-PROFILE-01 part B (migration 453): ONLY on a Professional link, ONLY what the person
  // ticked for this link, each record with its own evidence class and verification state, never upgraded.
  const sharedProfile = carriesOwn
    ? await loadSharedProfile(admin, share.id, share.nurse_id, (await loadIndividualPolicy(admin)).professionalProfile.shareSections, new Date().toISOString().slice(0, 10))
    : null;
  const sharedAny = !!sharedProfile && (!!sharedProfile.overview || sharedProfile.records.length > 0);
  // A Professional-minted link names the person's profession as THEY declared it, and says so. It never
  // shows profiles.role, which the new-user trigger fills with a default (migration 335) and which
  // Competen Individual neither sets nor relies on (ADR-016).
  const registration = own?.find(o => o.kind === "registration");
  const declaredProfession = registration && registration.title !== PROFESSION_NOT_RECORDED ? registration.title : null;
  const ownSubtitle = declaredProfession ? `${declaredProfession} (self-declared)` : null;

  return (
    <Shell>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-r from-teal-700 to-teal-600 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-teal-100/80 font-semibold">{carriesOwn ? "Competen · Passport" : "Competen · Verified Passport"}</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] bg-white/15 rounded-full px-2.5 py-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />Valid</span>
          </div>
          <div className="flex items-center gap-4 mt-3">
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold shrink-0">{profile?.full_name?.[0] ?? "?"}</div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold truncate">{profile?.full_name ?? "Professional"}</h1>
              <p className="text-teal-50 text-sm capitalize">{carriesOwn ? ownSubtitle : <>{roleLabel}{profile?.specialization ? ` · ${profile.specialization}` : ""}</>}</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-teal-50 rounded-xl p-3"><p className="text-2xl font-bold text-teal-700 tabular-nums">{current.length}</p><p className="text-[11px] text-gray-500">Current competencies</p></div>
            <div className="bg-teal-50 rounded-xl p-3"><p className="text-2xl font-bold text-teal-700 tabular-nums">{credentials.length}</p><p className="text-[11px] text-gray-500">Verified credentials</p></div>
            <div className="bg-teal-50 rounded-xl p-3"><p className="text-2xl font-bold text-teal-700 tabular-nums">{new Set(competencyNames).size}</p><p className="text-[11px] text-gray-500">Distinct areas</p></div>
          </div>

          {currencySummary.caveated > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-[12px] font-semibold text-amber-900">
                {/* NOT "has since changed" -- that is only true of the superseded and retired subsets. For an
                    unstamped entry the framework may well be unchanged; what is missing is the record of which
                    version it was assessed against. Claiming change would be the same over-claim, pointed the
                    other way. */}
                {currencySummary.caveated} of {currencySummary.total} shown here cannot be confirmed against the framework&apos;s current version
              </p>
              <p className="text-[11px] text-amber-800/90 mt-0.5 leading-relaxed">
                {[
                  currencySummary.unstamped ? `${currencySummary.unstamped} predate version stamping` : null,
                  currencySummary.superseded ? `${currencySummary.superseded} against an earlier version` : null,
                  currencySummary.retired ? `${currencySummary.retired} against a framework since withdrawn` : null,
                  currencySummary.unknown ? `${currencySummary.unknown} could not be resolved` : null,
                ].filter(Boolean).join(" · ")}. Each assessment is a genuine record and remains in date. Confirm
                with the issuing organisation if you need currency against today&apos;s standard.
              </p>
            </div>
          )}

          {full && competencyNames.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Current competencies</h2>
              <div className="flex flex-wrap gap-1.5">{competencyNames.slice(0, 40).map((n, i) => <span key={i} className="text-[11px] bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">{n}</span>)}</div>
            </div>
          )}

          {full && credentials.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Verified credentials</h2>
              <div className="space-y-1.5">
                {credentials.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12.5px] border-b border-gray-50 pb-1.5">
                    <span className="text-emerald-500">✓</span>
                    <span className="font-medium text-gray-800 flex-1 min-w-0 truncate">{c.title}</span>
                    <span className="text-[10px] text-gray-400">{CRED_LABEL[c.credential_type] ?? c.credential_type}</span>
                    {c.issuing_body && <span className="text-[11px] text-gray-500 truncate max-w-[9rem]">{c.issuing_body}</span>}
                    {c.expiry_date && <span className="text-[10px] text-gray-400 tabular-nums">exp {fmt(c.expiry_date)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {carriesOwn && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Records the professional added themselves</h2>
              <p className="text-[11.5px] text-amber-900 mt-0.5 leading-relaxed">Recorded by the professional in Competen Professional. They are not verified by Competen or by any organisation. Where it says a document is attached, the document was not checked and is not shared here.</p>
              {own === null ? <p className="text-[12px] text-gray-600 mt-2">These records could not be read just now.</p>
                : own.length === 0 ? <p className="text-[12px] text-gray-600 mt-2">None recorded.</p>
                  : !full ? (
                    <p className="text-[12.5px] text-gray-700 mt-2">{ownSummary!.total} {ownSummary!.total === 1 ? "record" : "records"}: {ownSummary!.byClass.self_declared} {EVIDENCE_LABEL.self_declared.toLowerCase()}, {ownSummary!.byClass.source_linked} {EVIDENCE_LABEL.source_linked.toLowerCase()}.</p>
                  ) : (
                    <div className="space-y-1.5 mt-2">
                      {own.slice(0, 60).map((o, i) => (
                        <div key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] border-b border-amber-100 pb-1.5">
                          <span className="font-medium text-gray-800 min-w-0">{o.title}</span>
                          <span className="text-[10.5px] text-gray-500">{OWN_KIND_LABEL[o.kind]}{o.detail ? ` · ${o.detail}` : ""}{o.date ? ` · ${fmt(o.date)}` : ""}{o.expires ? ` · exp ${fmt(o.expires)}` : ""}</span>
                          <span className="ml-auto text-[10.5px] font-semibold text-amber-900">{EVIDENCE_LABEL[o.evidence]}</span>
                          {o.competencies.length > 0 && <span className="w-full text-[10.5px] text-gray-600">Linked by the holder to: {o.competencies.join(", ")} (not verified)</span>}
                        </div>
                      ))}
                    </div>
                  )}
            </div>
          )}

          {carriesOwn && sharedProfile === null && <p className="text-[12px] text-gray-600">The professional profile shared on this link could not be read just now.</p>}
          {sharedAny && (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">From the professional&apos;s profile</h2>
              <p className="text-[11.5px] text-gray-600 mt-0.5 leading-relaxed">Chosen by the professional for this link. Recorded by them. A record is independently verified only where it says so: a Competen verifier, independent of the professional, checked that exact record. Registration numbers and documents are not shared.</p>
              {sharedProfile!.overview && (
                <p className="text-[12.5px] text-gray-800 mt-2">{[sharedProfile!.overview.profession, sharedProfile!.overview.title, sharedProfile!.overview.specialty, sharedProfile!.overview.setting, sharedProfile!.overview.status, sharedProfile!.overview.jurisdiction].filter(Boolean).join(" · ") || "No details recorded"} <span className="text-[10.5px] font-semibold text-amber-900">({EVIDENCE_LABEL.self_declared})</span></p>
              )}
              {sharedProfile!.records.length > 0 && (!full ? (
                <p className="text-[12.5px] text-gray-700 mt-2">{sharedProfile!.records.length} profile {sharedProfile!.records.length === 1 ? "record" : "records"}, {sharedProfile!.records.filter(r => isIndependentlyVerified(r.verification.state)).length} independently verified.</p>
              ) : (
                <div className="space-y-1.5 mt-2">
                  {sharedProfile!.records.map((r, i) => {
                    const ok = isIndependentlyVerified(r.verification.state);
                    return (
                      <div key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] border-b border-gray-100 pb-1.5">
                        <span className="font-medium text-gray-800 min-w-0">{r.title}</span>
                        <span className="text-[10.5px] text-gray-500">{ITEM_LABEL[r.section].charAt(0).toUpperCase() + ITEM_LABEL[r.section].slice(1)}{r.typeLabel ? ` · ${r.typeLabel}` : ""}{r.organisation ? ` · ${r.organisation}` : ""}{r.jurisdiction ? ` · ${r.jurisdiction}` : ""}{r.startedOn ? ` · from ${fmt(r.startedOn)}` : ""}{r.endedOn ? ` to ${fmt(r.endedOn)}` : ""}{r.expiresOn ? ` · exp ${fmt(r.expiresOn)}` : ""}{r.targetOn ? ` · by ${fmt(r.targetOn)}` : ""}</span>
                        <span className="ml-auto text-[10.5px] font-semibold text-amber-900">{EVIDENCE_LABEL[r.evidenceClass === "source_linked" ? "source_linked" : "self_declared"]}</span>
                        {["qualification", "registration", "employment"].includes(r.section) && (
                          <span className={`w-full text-[10.5px] font-semibold ${ok ? "text-emerald-700" : "text-gray-600"}`}>{ok ? "✓ " : ""}{VERIFICATION_LABEL[r.verification.state]}{ok && r.verification.method ? ` · ${METHOD_LABEL[r.verification.method]}, ${fmt(r.verification.verifiedAt)}${r.verification.validUntil ? `, valid until ${fmt(r.verification.validUntil)}` : ""}` : ""}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {study && (!study.ok ? !study.notProvisioned : study.data.length > 0) && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Self-directed study the professional chose to show</h2>
              <p className="text-[11.5px] text-sky-900 mt-0.5 leading-relaxed">{EVIDENCE_LABEL.self_directed}. Practice the professional did on their own study notes in Competen Scholar. It was not assessed by Competen or by any organisation, and their notes, answers and results are not shared here.</p>
              {!study.ok ? <p className="text-[12px] text-gray-600 mt-2">These could not be read just now.</p>
                : !full ? (
                  <p className="text-[12.5px] text-gray-700 mt-2">{study.data.length} self-directed study {study.data.length === 1 ? "achievement" : "achievements"}.</p>
                ) : (
                  <div className="space-y-1.5 mt-2">
                    {study.data.map(a => (
                      <div key={`${a.materialId}-${a.achievement}`} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] border-b border-sky-100 pb-1.5">
                        <span className="font-medium text-gray-800 min-w-0">{a.label}</span>
                        <span className="text-[10.5px] text-gray-500">{STUDY_ACHIEVEMENT[a.achievement].name} · {studyDetail(a)}{a.lastStudied ? ` · last studied ${fmt(a.lastStudied)}` : ""}</span>
                        <span className="ml-auto text-[10.5px] font-semibold text-sky-900">{EVIDENCE_LABEL.self_directed}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}

          {!full && <p className="text-[12px] text-gray-500">This is a summary verification. The professional can share a detailed link that lists their current competencies and verified credentials.</p>}

          <div className="border-t border-gray-100 pt-4 text-[11px] text-gray-400 space-y-0.5">
            {share.label && <p className="text-gray-500">Purpose: {share.label}</p>}
            <p>Shared {fmt(share.created_at)} · valid until {fmt(share.expires_at)}.</p>
            {carriesOwn
              ? <p>A consented, time-limited link shared by the professional, revocable at any time. Competencies and credentials above the self-recorded section were issued or verified by an organisation. The self-recorded section is the professional&apos;s own account.</p>
              : <p>A consented, time-limited verification shared by the professional. It shows only verified, current achievements and can be revoked at any time. Verified by the Competen Competency Passport.</p>}
          </div>
        </div>
      </div>
    </Shell>
  );
}
