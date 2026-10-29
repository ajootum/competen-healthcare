import { loadProfessionalProfile } from "@/lib/individual/professional/profile-store";
import { loadCompetencyWorkspace } from "@/lib/individual/professional/competency-store";
import { listShares, loadShareHistory } from "@/lib/individual/professional/share";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { EVIDENCE_LABEL, loadIndividualPassport } from "@/lib/individual/passport";
import { OWN_KIND_LABEL } from "@/lib/individual/professional/passport-records";
import { STUDY_ACHIEVEMENT, studyDetail } from "@/lib/individual/scholar/passport-items";
import { learningCertificateHref, learningRecordHref } from "@/lib/individual/professional/learning";
import { admitToEstate } from "@/lib/platform-membership";
import { estateRolesOf, type AppRole } from "@/lib/roles";
import { experiencePage, gatedMetadata } from "../../../_components/shell-context";
import type { Metadata } from "next";
import { PageHeader, Unreadable, focusRing } from "../../../_components/chrome";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// THE COMPETEN PASSPORT IN COMPETEN INDIVIDUAL -- COMPETEN-IND-003 s2(5).
//
// The person's one existing Passport, read by their own id (src/lib/individual/passport.ts). Every item
// carries its evidence class in TEXT, never colour alone. The same page renders in both experiences
// because the Passport belongs to the person, not to an experience.
//
// ⚠ TWO CLASSES, LABELLED TWO WAYS (COMPETEN-IND-007 s5, owner ruling D3). What organisations issued is
// labelled by issuer. "Records you added" -- the person's own Competen Professional records -- is labelled
// by provenance, and nothing in it ever says verified. "Self-directed study" -- Competen Scholar
// achievements -- shows only what the person chose to show, one at a time, labelled self-directed: never
// their notes, answers or AI interactions (migration 375, src/lib/individual/scholar/passport-items.ts).
// "Competen Learning" -- completed courses, read by reference from the Holdings learning record -- says exactly what
// each one is ("Course completion, issued by Competen Holdings", or self-declared), never verified. It is shown
// only while Learning is on, and it is NOT part of a shared /verify link: sharing it outward is a separate decision.
//
// ⚠ SHARING STAYS ON THE EXISTING SURFACE. /dashboard/passport/share mints the revocable /verify links,
// and it sits behind gate 1. A person who also holds gate 1 is pointed there. A person who does not is
// told plainly that sharing from Competen Individual is not available yet -- rather than offered a link
// that bounces, or a second share mechanism that would duplicate the first. A person who holds Competen
// Professional shares from its share page, which mints the SAME passport_share_tokens link.

const fmt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Competen Passport" }); }

export default async function PassportPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experiencePage((await params).experience);
  if (!page) return null;
  const { ctx, experience } = page;
  const x = EXPERIENCES[experience];
  const passport = await loadIndividualPassport(ctx.admin, ctx.userId, new Date().toISOString().slice(0, 10));

  // Pointer only: the share surface re-checks gate 1 itself on arrival.
  const { data: roleRow } = await ctx.admin.from("profiles").select("role, roles").eq("id", ctx.userId).maybeSingle();
  const holdsEstate = (await admitToEstate(ctx.admin, ctx.userId, estateRolesOf(roleRow ?? null) as AppRole[])).admitted;

  // COMPETEN-PROFESSIONAL-PASSPORT-01 P1: with Professional, the same Passport also shows the person's qualifications and
  // registrations, their competencies (self-assessed apart from verified) and their shared views, each read from its
  // owning service. Scholar history stays whatever the person later activates: nothing here is copied or moved.
  const pro = ctx.live.includes("professional");
  const [profile, comp, links] = pro
    ? await Promise.all([loadProfessionalProfile(ctx.admin, ctx.userId), loadCompetencyWorkspace(ctx.admin, ctx.userId), listShares(ctx.admin, ctx.userId)])
    : [null, null, null];
  const history = links ? await loadShareHistory(ctx.admin, ctx.userId, links.map(l => l.id)) : new Map();
  const quals = (profile?.items ?? []).filter(i => (i.section === "qualification" || i.section === "registration") && !i.superseded_at && !i.withdrawn_at);
  const entries = (comp?.entries ?? []).filter(e => !e.removed_at);
  const nowIso = new Date().toISOString();

  const current = passport.competencies?.filter(c => c.current) ?? [];
  const notCurrent = passport.competencies?.filter(c => !c.current) ?? [];

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your foundation" title="Competen Passport"
        intro="Your lifelong record of what you know and can do. It is the same Passport in Competen Scholar and Competen Professional, and it stays with you between organisations." />

      <Section title="At a glance" note="Private to you. Nothing here is shared unless you choose it, record by record, on a Passport view.">
        <ul className="grid gap-2 text-[13.5px] text-gray-800 sm:grid-cols-2">
          <li>Assessed by organisations: <span className="font-semibold">{passport.competencies === null ? "could not be read" : current.length}</span> current</li>
          <li>Credentials and registrations held with organisations: <span className="font-semibold">{passport.credentials === null ? "could not be read" : passport.credentials.length}</span></li>
          {pro && <li>Qualifications and registrations you recorded: <span className="font-semibold">{profile?.items === null ? "could not be read" : quals.length}</span></li>}
          {pro && <li>Competencies you are developing: <span className="font-semibold">{comp?.entries === null ? "could not be read" : entries.length}</span></li>}
          {passport.learning?.enabled && <li>Competen Learning completed: <span className="font-semibold">{passport.learning.items === null ? "could not be read" : passport.learning.items.length}</span></li>}
          <li>Scholar study shown: <span className="font-semibold">{passport.study.ok ? passport.study.data.length : "not available"}</span></li>
        </ul>
      </Section>

      <h2 className="mt-8 mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Issued or verified by organisations</h2>
      <p className="-mt-2 mb-3 text-[13px] text-gray-600">Decided or confirmed by an organisation, each labelled by who issued it.</p>
      <Section title="Assessed competencies" note={`${EVIDENCE_LABEL.institution_issued}. Each one is the latest decision an organisation recorded for you.`}>
        {passport.competencies === null ? <Unreadable what="assessed competencies" />
          : passport.competencies.length === 0 ? <Empty>No assessed competencies on your record yet. When an organisation assesses you through Competen, the decision appears here.</Empty>
            : (
              <ul className="divide-y divide-gray-100">
                {[...current, ...notCurrent].map(c => (
                  <li key={c.competencyId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{c.name}</p>
                      <p className="text-[12.5px] text-gray-500">{c.issuer ? `Issued by ${c.issuer}` : "Issuing organisation not recorded"}{c.decidedAt ? ` · ${fmt(c.decidedAt)}` : ""}</p>
                    </div>
                    <p className={`text-[12.5px] font-semibold ${c.current ? "text-green-800" : "text-gray-600"}`}>
                      {c.current ? "Current" : c.outcome.replace(/_/g, " ")}
                      {c.expiryDate ? ` · ${c.current ? "expires" : "expiry"} ${fmt(c.expiryDate)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
      </Section>

      {passport.verifications?.provisioned && (
        <Section title="Verified by Competen Holdings" note="Each one is the outcome of one independent assessment, by the method and criteria version stated. It is not a general declaration of professional competence.">
          {passport.verifications.items === null ? <Unreadable what="Competen Holdings verifications" />
            : passport.verifications.items.length === 0 ? <Empty>No verified competencies yet. When a Competency Assessor verifies a competency you asked to be assessed, it appears here.</Empty>
              : (
                <ul className="divide-y divide-gray-100">
                  {passport.verifications.items.map(v => (
                    <li key={v.decisionId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-semibold text-gray-900">{v.title}{v.code ? <span className="font-normal text-gray-500"> · {v.code}</span> : null}</p>
                        <p className="text-[12.5px] text-gray-500">
                          {v.issuer} · {v.method.name ?? "Assessment method"}{v.method.versionNo ? `, version ${v.method.versionNo}` : ""} · framework version {v.frameworkVersion ?? "not recorded"} · {fmt(v.decidedAt)}
                        </p>
                        {v.components && (
                          <p className="text-[12.5px] text-gray-600">
                            Components: {v.components.status === "achieved" ? "all reached" : v.components.status === "incomplete" ? "incomplete" : "not all reached"}
                            {v.components.results.length ? ` (${v.components.results.map(r => `${r.code.replace(/_/g, " ")} ${r.score === null ? "not assessed" : r.score}`).join(", ")})` : ""}
                          </p>
                        )}
                      </div>
                      <p className={`text-[12.5px] font-semibold ${v.current ? "text-green-800" : "text-gray-600"}`}>
                        {v.outcomeLabel}{v.level ? ` · level ${v.level.score} ${v.level.label}` : ""} · {v.current ? "Current" : v.standing.replace(/_/g, " ")}
                        {v.validUntil && (v.current || v.standing === "expired") ? ` · ${v.current ? "valid until" : "expired"} ${fmt(v.validUntil)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
        </Section>
      )}

      <Section title="Credentials and registrations" note="Each one says whether an organisation verified it or it was only declared.">
        {passport.credentials === null ? <Unreadable what="credentials" />
          : passport.credentials.length === 0 ? <Empty>No credentials on your record yet.</Empty>
            : (
              <ul className="divide-y divide-gray-100">
                {passport.credentials.map((c, i) => (
                  <li key={`${c.title}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{c.title}</p>
                      <p className="text-[12.5px] text-gray-500">{[c.issuingBody, c.type.replace(/_/g, " ")].filter(Boolean).join(" · ")}</p>
                    </div>
                    <p className={`text-[12.5px] font-semibold ${c.evidence === "institution_verified" ? "text-green-800" : "text-amber-800"}`}>
                      {EVIDENCE_LABEL[c.evidence]}{c.status !== "active" ? ` · ${c.status.replace(/_/g, " ")}` : ""}{c.expiryDate ? ` · expires ${fmt(c.expiryDate)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
      </Section>

      <Section title="Employment" note={`${EVIDENCE_LABEL.institution_issued}. Kept after you leave.`}>
        {passport.employment === null ? <Unreadable what="employment history" />
          : passport.employment.length === 0 ? <Empty>No employment recorded through Competen.</Empty>
            : (
              <ul className="divide-y divide-gray-100">
                {passport.employment.map((e, i) => (
                  <li key={`${e.roleTitle}-${i}`} className="py-3">
                    <p className="text-[14.5px] font-semibold text-gray-900">{e.roleTitle}{e.organisation ? `, ${e.organisation}` : ""}</p>
                    <p className="text-[12.5px] text-gray-500">{fmt(e.startDate) ?? "Start not recorded"} – {e.endDate ? fmt(e.endDate) : "present"} · {e.status.replace(/_/g, " ")}</p>
                  </li>
                ))}
              </ul>
            )}
      </Section>

      {passport.learning?.enabled && (
        <Section title="Competen Learning" note="Courses you completed, read from your Competen Learning record. Each says what it is. A course completion or assessed knowledge is not an accreditation or a verification of clinical competence. On a shared view only when you tick it.">
          {passport.learning.items === null ? <Unreadable what="learning record" />
            : passport.learning.items.length === 0 ? <Empty>No completed Competen Learning courses yet.</Empty>
              : (
                <ul className="divide-y divide-gray-100">
                  {passport.learning.items.map(l => (
                    <li key={l.recordId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-semibold text-gray-900"><a href={learningRecordHref(l.recordId)} className={`underline-offset-2 hover:underline ${focusRing}`}>{l.title}</a></p>
                        <p className="text-[12.5px] text-gray-500">{[l.detail, l.date ? fmt(l.date) : null].filter(Boolean).join(" · ")}</p>
                        {l.certificateNos.length > 0 && (
                          <p className="text-[12.5px]">{l.certificateNos.map(no => (
                            <a key={no} href={learningCertificateHref(no)} className={`mr-3 font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Certificate {no}</a>
                          ))}</p>
                        )}
                      </div>
                      <p className={`text-[12.5px] font-semibold ${l.evidence === "platform_recorded" ? "text-slate-800" : "text-amber-800"}`}>{l.label}</p>
                    </li>
                  ))}
                </ul>
              )}
        </Section>
      )}

      <h2 className="mt-8 mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Recorded by you</h2>
      <p className="-mt-2 mb-3 text-[13px] text-gray-600">Self-declared. A document makes a record document-supported, never verified.</p>
      {pro && (
        <Section title="Qualifications and registrations" note="Recorded by you in My practice and Profile & history. Each says whether Competen verified it.">
          {profile?.items === null ? <Unreadable what="professional profile" /> : quals.length === 0 ? <Empty>None recorded yet.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {quals.map(q => (
                <li key={q.id} className="py-2 text-[14px]">
                  <span className="font-semibold text-gray-900">{q.title}</span>
                  <span className="text-[12.5px] text-gray-500">{[q.type_label, q.organisation, q.jurisdiction, q.expires_on ? `expires ${fmt(q.expires_on)}` : null].filter(Boolean).map(t => ` · ${t}`).join("")} · {q.evidence_class === "source_linked" ? EVIDENCE_LABEL.source_linked : EVIDENCE_LABEL.self_declared}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[13px]"><a href={experienceHref("professional", "registration")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: EXPERIENCES.professional.accent }}>Manage them in My practice</a></p>
        </Section>
      )}

      <Section title="Credentials and evidence you added" note="Recorded by you in Competen Professional. Each one says whether a document is attached. None of them is verified.">
        {passport.own === null ? <Unreadable what="own records" />
          : passport.own.length === 0 ? <Empty>{ctx.live.includes("professional") ? "Nothing yet. Your registration, credentials, competency evidence and CPD from Competen Professional appear here." : "Nothing yet. Records you add in Competen Professional appear here."}</Empty>
            : (
              <ul className="divide-y divide-gray-100">
                {passport.own.map((o, i) => (
                  <li key={`${o.kind}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{o.title}</p>
                      <p className="text-[12.5px] text-gray-500">{[OWN_KIND_LABEL[o.kind], o.detail, o.date ? fmt(o.date) : null].filter(Boolean).join(" · ")}</p>
                      {o.competencies.length > 0 && <p className="text-[12.5px] text-gray-600">Linked by you to: {o.competencies.join(", ")}</p>}
                    </div>
                    <p className="text-[12.5px] font-semibold text-amber-800">
                      {EVIDENCE_LABEL[o.evidence]}{o.expires ? ` · ${o.expires < new Date().toISOString().slice(0, 10) ? "expired" : "expires"} ${fmt(o.expires)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
      </Section>

      {pro && comp?.provisioned && (
        <Section title="Competencies" note="What you are developing. Your self-assessments are self-reported; supporting evidence is not verification; only an appointed assessor's outcome is independently verified.">
          {comp.entries === null ? <Unreadable what="competencies" /> : entries.length === 0 ? <Empty>None yet.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {entries.slice(0, 30).map(e => {
                const sa = (comp.assessments ?? []).find(a => a.my_competency_id === e.id);
                const ev = (comp.links ?? []).filter(l => l.my_competency_id === e.id && !l.unlinked_at).length;
                return (
                  <li key={e.id} className="py-2 text-[14px]">
                    <span className="font-semibold text-gray-900">{e.title}</span>
                    <span className="text-[12.5px] text-gray-500">{e.framework_version ? ` · ${e.framework_version}` : " · in your own words"}{sa ? ` · self-assessed ${sa.level_label} (self-reported)` : " · not self-assessed"}{` · ${ev} evidence`}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[13px]"><a href={experienceHref("professional", "competencies")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: EXPERIENCES.professional.accent }}>Open My competencies</a></p>
        </Section>
      )}

      <h2 className="mt-8 mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Your study in Competen Scholar</h2>
      <p className="-mt-2 mb-3 text-[13px] text-gray-600">Formative learning you chose to show. Never verified competence.</p>
      <Section title="Self-directed study" note={`${EVIDENCE_LABEL.self_directed}. Only the Competen Scholar achievements you chose to show. Your notes, answers and anything the AI wrote are never shown.`}>
        {!passport.study.ok ? (passport.study.notProvisioned
          ? <Empty>Showing study achievements is not available here yet.</Empty>
          : <Unreadable what="study achievements" />)
          : passport.study.data.length === 0 ? (
            <Empty>
              {ctx.live.includes("scholar")
                ? <>Nothing shown. You can choose achievements to show, one at a time, from <a href={experienceHref("scholar", "study/progress")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: EXPERIENCES.scholar.accent }}>Progress in My Learning</a>.</>
                : "Nothing shown. Nothing from Competen Scholar appears here unless you choose it."}
            </Empty>
          ) : (
            <ul className="divide-y divide-gray-100">
              {passport.study.data.map(a => (
                <li key={`${a.materialId}-${a.achievement}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-semibold text-gray-900">{a.label}</p>
                    <p className="text-[12.5px] text-gray-500">{[STUDY_ACHIEVEMENT[a.achievement].name, studyDetail(a), a.lastStudied ? `last studied ${fmt(a.lastStudied)}` : null].filter(Boolean).join(" · ")}</p>
                  </div>
                  <p className="text-[12.5px] font-semibold text-sky-800">{EVIDENCE_LABEL.self_directed}</p>
                </li>
              ))}
            </ul>
          )}
      </Section>

      {/* PROGRESS-01 P5: the middle tier -- educational evaluation, apart from study activity and from verified competence. */}
      <Section title="Educational evaluations" note={`${EVIDENCE_LABEL.educational_evaluation}. Only the Competen Scholar evaluations you chose to show: how each was made and how far it can be relied on, never your notes or answers, and never a credential.`}>
        {!passport.evaluations.ok ? (passport.evaluations.notProvisioned
          ? <Empty>Showing evaluations is not available here yet.</Empty>
          : <Unreadable what="educational evaluations" />)
          : passport.evaluations.data.length === 0 ? (
            <Empty>
              {ctx.live.includes("scholar")
                ? <>Nothing shown. You can choose an evaluation to show from <a href={experienceHref("scholar", "study/evaluate")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: EXPERIENCES.scholar.accent }}>Evaluate in My Learning</a>.</>
                : "Nothing shown. Nothing from Competen Scholar appears here unless you choose it."}
            </Empty>
          ) : (
            <ul className="divide-y divide-gray-100">
              {passport.evaluations.data.map(ev => (
                <li key={ev.evaluationId} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-[14.5px] font-semibold text-gray-900">{ev.label}</p>
                    <p className="text-[12.5px] font-semibold text-indigo-800">{EVIDENCE_LABEL.educational_evaluation}</p>
                  </div>
                  <p className="text-[12.5px] text-gray-500">{[ev.scope, ev.method, `made ${fmt(ev.madeAt)}`, ev.confidence, `${ev.limitations} limitation${ev.limitations === 1 ? "" : "s"} stated`].join(" · ")}</p>
                  <p className="mt-1 text-[12.5px] text-gray-700">{ev.dimensions.map(d => `${d.name}: ${d.reads}`).join(" · ")}</p>
                </li>
              ))}
            </ul>
          )}
      </Section>

      {pro && links !== null && links.length > 0 && (
        <Section title="Shared views" note="Every view you made, what it was for, whether it is a draft, live, expired or withdrawn, and how often it was opened.">
          <ul className="divide-y divide-gray-100">
            {links.slice(0, 20).map(l => {
              const h = history.get(l.id);
              const state = l.revoked ? "Withdrawn" : l.expires_at && l.expires_at < nowIso ? "Expired" : h?.draft ? "Draft" : "Live";
              return (
                <li key={l.id} className="py-2 text-[14px]">
                  <span className="font-semibold text-gray-900">{h?.purpose ?? l.label ?? "Passport link"}</span>
                  <span className="text-[12.5px] text-gray-500">{h?.recipient ? ` · for ${h.recipient}` : ""} · {state} · opened {h ? h.opened : l.view_count}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="Sharing">
        {/* PRODUCT-EXPERIENCE P4: in Scholar, share chosen study and evaluations as formative records. */}
        {experience === "scholar" && (
          <p className="mb-2 text-[14px] text-gray-700">
            Share the study achievements and evaluations you choose, labelled formative, with a tutor, a course or an employer:{" "}
            <a href={experienceHref("scholar", "passport/share")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Share from your Passport</a>.
          </p>
        )}
        {ctx.live.includes("professional") ? (
          <p className="text-[14px] text-gray-700">
            You choose exactly what a view shows, record by record, preview it, and only then make it live. Make one from{" "}
            <a href={experienceHref("professional", "share")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: EXPERIENCES.professional.accent }}>Share your Passport</a>.
            {/* COMPETEN-PROFESSIONAL-PROGRESS-01 PR7: the Document Studio, opened from the Passport (agreed with Stage 7). */}
            {" "}Or <a href={`${experienceHref("professional", "progress/documents")}?origin=passport`} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: EXPERIENCES.professional.accent }}>create a document</a> (a CV, Passport export or portfolio) from records you choose.
          </p>
        ) : holdsEstate ? (
          <p className="text-[14px] text-gray-700">
            You can share a revocable, time-limited verification link from{" "}
            <a href="/dashboard/passport/share" className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>your Passport sharing page</a>.
          </p>
        ) : experience === "scholar" ? (
          <p className="text-[14px] text-gray-700">Nothing is shared with anyone unless you choose it, record by record.</p>
        ) : (
          <p className="text-[14px] text-gray-700">Sharing your Passport from Competen Individual is not available yet. Nothing is shared with anyone unless you choose to share it.</p>
        )}
      </Section>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 className="text-[16px] font-bold text-gray-900">{title}</h2>
      {note && <p className="mt-0.5 text-[12.5px] text-gray-500">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] text-gray-600">{children}</p>;
}
