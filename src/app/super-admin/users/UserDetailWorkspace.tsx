"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/ui/interactive";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/hq/account-classification";
import { PARTICIPATION_LABEL, type ParticipationCategory } from "@/lib/hq/account-participation";
import type { Readable } from "@/lib/hq/user-directory";
import {
  DETAIL_SECTIONS, EXPERIENCE_NAME, RESTRICTED_RECORDS, actionLabel, formatDay, prefillRows, type DetailSectionId,
} from "@/lib/hq/user-detail";
import { ROLE_CONFIG, ORG_ROLE_CONFIG, PLATFORM_ROLE_CONFIG, type AppRole, type OrgRole, type PlatformRole } from "@/lib/roles";
import { formatDateTime } from "@/lib/datetime";
import UserRoleEditor from "./UserRoleEditor";
import UserDetailPersonal from "./UserDetailPersonal";
import UserDetailProducts from "./UserDetailProducts";
import type { UserRow } from "./UsersWorkspace";
import type { AuditPage, PersonalDetail, Src, UserDetail } from "./user-detail-load";
import { ROLE_BADGE, STATUS_UI, TYPE_PILL, relTime, tint } from "./users-ui";
import { Field, Notice, SectionCard, SourceNote, StatePill, SubHead, ValueOrState, btn } from "./UserDetailParts";

// The user detail workspace -- a profile in seven sections, opened over the directory from ?user=<id>.
//
//   Desktop  a wide panel beside the still-mounted list (search, filters and scroll position survive).
//   Tablet   the same panel, filling the width the screen has.
//   Phone    FULL SCREEN, with a sticky jump list of the seven sections under the title.
//
// ⚠ PRIVACY. HQ never sees a person's Scholar notes, learning history, Personal AI, formative assessments, plans or
// personal development records. Section 7 says so as Restricted and reads none of them.

export default function UserDetailWorkspace({
  user, canManage, canReset, currentUserId, hospitals, organisations, departments,
  classificationAvailable, readable, participationAvailable, onClose, onChanged, onDelete,
}: {
  user: UserRow;
  canManage: boolean;
  canReset: boolean;
  currentUserId: string;
  hospitals: { id: string; name: string; country: string }[];
  organisations: { id: string; name: string }[];
  departments: { id: string; name: string; hospital_id: string }[];
  classificationAvailable: boolean;
  readable: Readable;
  participationAvailable: boolean;
  onClose: () => void;
  /** Read the directory again (the row behind the profile changed). */
  onChanged: () => void;
  onDelete: (u: UserRow) => void;
}) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<DetailSectionId>("personal");
  const root = useRef<HTMLDivElement>(null);

  // Read the profile when it opens, and again whenever `nonce` moves (after a save, or Try again). The parent keys this
  // component by person, so a new person starts from empty state.
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/super-admin/users/${user.id}`, { signal: ctl.signal, cache: "no-store" })
      .then(async res => {
        const j = (await res.json().catch(() => ({}))) as { detail?: UserDetail; error?: string };
        if (!res.ok || !j.detail) { setLoadError(j.error ?? "The profile could not be loaded."); return; }
        setDetail(j.detail); setLoadError(null);
      })
      .catch(e => {
        if ((e as Error).name !== "AbortError") setLoadError("The profile could not be loaded. Check your connection and try again.");
      });
    return () => ctl.abort();
  }, [user.id, nonce]);

  const reload = () => setNonce(n => n + 1);
  // After a save: show the saved values at once (the route returns them), then read the detail again so the full name
  // and the audit trail catch up, and refresh the directory row. `auditKey` remounts the audit list, which keeps its
  // own rows once mounted.
  const [auditKey, setAuditKey] = useState(0);
  const afterSave = (saved?: Record<string, string | null>) => {
    if (saved) setDetail(d => (d && d.personal.state === "ok" ? { ...d, personal: { state: "ok", value: mergeSaved(d.personal.value, saved) } } : d));
    setAuditKey(k => k + 1);
    reload(); onChanged();
  };

  function jump(id: DetailSectionId) {
    setActive(id);
    root.current?.querySelector(`#ud-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const st = STATUS_UI[user.status];
  const participationLabel = user.participation ? PARTICIPATION_LABEL[user.participation as ParticipationCategory] ?? user.participation : null;

  return (
    <Drawer open title={user.name} onClose={onClose} wide>
      <div ref={root} className="-mx-5 -mt-5">
        {/* identity strip */}
        <div className="flex items-start gap-3 px-5 pt-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white ${tint(user.id)}`} aria-hidden="true">
            {user.name[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-gray-600">{user.email}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${st.pill}`}>{st.label} · {user.statusDetail}</span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${TYPE_PILL[user.accountType]}`} title="Account type (administrative, grants no access)">{ACCOUNT_TYPE_LABEL[user.accountType]}</span>
              {participationLabel && <span className="rounded bg-[var(--cmp-surface-neutral)] px-1.5 py-0.5 text-[11px] font-bold text-gray-700" title="Access category (a label, grants no access)">{participationLabel}</span>}
            </div>
          </div>
        </div>

        {/* sticky section navigation: a jump list on every screen, the way around on a phone */}
        <nav aria-label="Profile sections" className="sticky top-14 z-[1] mt-3 border-b border-gray-200 bg-white">
          <ul className="flex gap-1 overflow-x-auto px-5 py-2">
            {DETAIL_SECTIONS.map((s, i) => (
              <li key={s.id} className="shrink-0">
                <button type="button" onClick={() => jump(s.id)} aria-current={active === s.id ? "true" : undefined} title={s.label}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)] ${active === s.id ? "border-teal-700 bg-teal-700 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
                  <span className="tabular-nums text-[11px] opacity-70">{i + 1}</span> {s.short}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="px-5 pb-8">
          {loadError && (
            <div className="mt-4">
              <Notice kind="err">{loadError}</Notice>
              <button type="button" onClick={() => { setLoadError(null); reload(); }} className={`${btn} mt-2`}>Try again</button>
            </div>
          )}
          {!detail && !loadError && <p role="status" className="py-8 text-center text-[13px] text-gray-500">Loading the profile{"…"}</p>}

          {detail && (
            <>
              <UserDetailPersonal userId={user.id} personal={detail.personal} preferred={detail.preferred} canManage={canManage} onSaved={afterSave} />
              <EducationSection detail={detail} />
              <UserDetailProducts userId={user.id} products={detail.products} names={detail.names} canManage={canManage}
                participationAvailable={participationAvailable} onChanged={afterSave} />
              <RolesSection user={user} detail={detail} canManage={canManage} readable={readable}
                hospitals={hospitals} organisations={organisations} departments={departments} onClose={onClose} onChanged={onChanged} />
              <AccountSection user={user} detail={detail} canManage={canManage} canReset={canReset} currentUserId={currentUserId}
                classificationAvailable={classificationAvailable} onChanged={onChanged} onDelete={onDelete} />
              <AuditSection key={auditKey} userId={user.id} initial={detail.audit} />
              <CompetencySection user={user} />
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ── 2. Education & Professional Context -- read-only, learner-owned ──────────────────────────────────────────

function EducationSection({ detail }: { detail: UserDetail }) {
  const ents = detail.products.entitlements.state === "ok" ? detail.products.entitlements.value : null;
  const holds = (x: string) => (ents ? ents.some(e => e.experience === x) : null);
  const { scholar, professional } = detail.education;
  const invs = detail.products.invitations.state === "ok" ? detail.products.invitations.value : [];
  const supplied = invs.map(i => ({ inv: i, rows: prefillRows(i.prefill) })).filter(x => x.rows.length > 0);

  return (
    <SectionCard id="education" title="Education & Professional Context" subtitle="Set by the person in their own profile. HQ reads labels only and cannot edit them.">
      <SubHead>Scholar: programme and institution</SubHead>
      {scholar.state !== "ok" ? <SourceNote state={scholar.state} what="Scholar programme details" />
        : scholar.value ? (
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
            <Field label="Programme"><ValueOrState value={scholar.value.programme} /></Field>
            <Field label="Level"><ValueOrState value={scholar.value.level} /></Field>
            <Field label="Institution"><ValueOrState value={scholar.value.institution} /></Field>
          </dl>
        ) : holds("scholar") ? <p className="text-[13px] text-gray-700"><StatePill state="missing" why="The person holds Scholar and has not chosen a programme yet." /> Set by the person in Scholar. Not chosen yet.</p>
        : <p className="text-[13px] text-gray-700"><StatePill state="not_applicable" why="The person has no Scholar experience." /> No Scholar experience.</p>}

      <SubHead>Professional: profession and registration</SubHead>
      {professional.state !== "ok" ? <SourceNote state={professional.state} what="Professional profile details" />
        : professional.value ? (
          <>
            <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
              <Field label="Profession"><ValueOrState value={professional.value.profession} /></Field>
              <Field label="Registration body"><ValueOrState value={professional.value.registrationBody} /></Field>
              <Field label="Registration country"><ValueOrState value={professional.value.registrationCountry} /></Field>
            </dl>
            <p className="mt-2 text-[11px] text-gray-500">Self-declared by the person and not verified here. The registration number is not shown to HQ.</p>
          </>
        ) : holds("professional") ? <p className="text-[13px] text-gray-700"><StatePill state="missing" why="The person holds Professional and has not completed a profile yet." /> Set by the person in Professional. Not completed yet.</p>
        : <p className="text-[13px] text-gray-700"><StatePill state="not_applicable" why="The person has no Professional experience." /> No Professional experience.</p>}

      {supplied.length > 0 && (
        <>
          <SubHead>Supplied at invitation, not yet confirmed</SubHead>
          {supplied.map(({ inv, rows }) => (
            <div key={inv.id} className="mb-2 rounded-lg border border-dashed border-gray-300 p-3">
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                {rows.map(r => <Field key={r.key} label={r.label}>{r.value}</Field>)}
              </dl>
              <p className="mt-2 text-[11px] text-gray-500">Entered by HQ when inviting on {formatDay(inv.createdAt)}. The person confirms or corrects these in their own profile. HQ does not write them there.</p>
            </div>
          ))}
        </>
      )}
    </SectionCard>
  );
}

// ── 4. Roles & Organisations ─────────────────────────────────────────────────────────────────────────────────

function RolesSection({ user, detail, canManage, readable, hospitals, organisations, departments, onClose, onChanged }: {
  user: UserRow; detail: UserDetail; canManage: boolean; readable: Readable;
  hospitals: { id: string; name: string; country: string }[]; organisations: { id: string; name: string }[];
  departments: { id: string; name: string; hospital_id: string }[]; onClose: () => void; onChanged: () => void;
}) {
  const editorUser = {
    id: user.id, full_name: user.name, email: user.email, role: user.role, roles: user.roles, org_role: user.orgRole, org_roles: user.orgRoles,
    hospital_id: user.hospitalId, organisation_id: user.organisationId, platform_role: user.platformRole, department_id: user.departmentId,
  };
  const a = user.access;
  const platformRole = user.platformRole && PLATFORM_ROLE_CONFIG[user.platformRole as PlatformRole];
  const orgRoles = (user.orgRoles ?? []).filter(r => ORG_ROLE_CONFIG[r as OrgRole]);
  const seat = (ok: boolean, body: React.ReactNode) => (ok ? body : <span className="text-[var(--cmp-text-warning)]">Not readable</span>);

  return (
    <SectionCard id="roles" title="Roles & Organisations" subtitle="Where the person works and what they are appointed to."
      action={canManage ? <UserRoleEditor user={editorUser} hospitals={hospitals} organisations={organisations} departments={departments}
        onSaved={() => { onClose(); onChanged(); }} /> : undefined}>
      <div className="flex flex-wrap gap-1.5">
        {platformRole && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700">{platformRole.icon} {platformRole.label}</span>}
        {orgRoles.map(r => <span key={r} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">{ORG_ROLE_CONFIG[r as OrgRole].icon} {ORG_ROLE_CONFIG[r as OrgRole].label}</span>)}
        {user.roles.map(r => <span key={r} className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${ROLE_BADGE[r] ?? "bg-gray-100 text-gray-600"}`}>{ROLE_CONFIG[r as AppRole]?.icon} {ROLE_CONFIG[r as AppRole]?.label ?? r}</span>)}
        {!platformRole && orgRoles.length === 0 && user.roles.length === 0 && <StatePill state="missing" why="No role is recorded for this person." />}
      </div>

      <dl className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label="Organisation"><ValueOrState value={user.organisation} /></Field>
        <Field label="Facility"><ValueOrState value={user.facility} /></Field>
        <Field label="Department"><ValueOrState value={user.department} /></Field>
        <Field label="Speciality"><ValueOrState value={user.specialization} /></Field>
      </dl>

      <SubHead>Product seats</SubHead>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-gray-500">Platform</dt>
        <dd>{seat(readable.platform, a.platform ?? "No membership")}</dd>
        <dt className="text-gray-500">Enterprise</dt>
        <dd>{seat(readable.enterprise, a.enterprise.length ? a.enterprise.map(e => `${e.tenant ?? "Unnamed tenant"} (${e.status})`).join(", ") : "No membership")}</dd>
        <dt className="text-gray-500">Practice</dt>
        <dd>{seat(readable.practice, a.practice.length ? a.practice.map(p => `${p.workspace ?? "Unnamed practice"}${p.role ? ` · ${p.role.replace(/_/g, " ")}` : ""} (${p.status})`).join(", ") : "No membership")}</dd>
        <dt className="text-gray-500">Individual</dt>
        <dd>{seat(readable.individual, !a.individual.membership ? "No membership" : `${a.individual.membership}${a.individual.live.length ? ` · live: ${a.individual.live.map(x => EXPERIENCE_NAME[x] ?? x).join(", ")}` : " · no live experience"}`)}</dd>
      </dl>

      <SubHead>HQ appointments</SubHead>
      {!readable.hq ? <p className="text-[12px] text-[var(--cmp-text-warning)]">Not readable just now. This is not the same as having none.</p>
        : detail.appointments.state !== "ok" ? <SourceNote state={detail.appointments.state} what="HQ appointments" />
        : detail.appointments.value.length === 0 ? <p className="text-[13px] text-gray-700"><StatePill state="not_applicable" why="This person holds no HQ position." /> No HQ appointment.</p>
        : (
          <ul className="flex flex-col gap-2">
            {detail.appointments.value.map((p, i) => (
              <li key={`${p.position}-${i}`} className="rounded-lg border border-gray-200 p-3 text-[12px] text-gray-700">
                <p className="text-[13px] text-gray-900"><b>{p.name ?? p.position}</b> · {p.status}</p>
                <p className="mt-0.5">Scope: {p.scope ?? "whole of the position"} · from {formatDay(p.validFrom)} · to {p.validTo ? formatDay(p.validTo) : "no end date"}</p>
              </li>
            ))}
          </ul>
        )}
      <p className="mt-3 text-[12px] text-gray-600">Privileged roles are appointed on the <a href="/super-admin/users/appointments" className="font-semibold text-teal-700 underline">HQ appointments</a> page.</p>
    </SectionCard>
  );
}

// ── 5. Account & Security ────────────────────────────────────────────────────────────────────────────────────

function AccountSection({ user, detail, canManage, canReset, currentUserId, classificationAvailable, onChanged, onDelete }: {
  user: UserRow; detail: UserDetail; canManage: boolean; canReset: boolean; currentUserId: string;
  classificationAvailable: boolean; onChanged: () => void; onDelete: (u: UserRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const me = user.id === currentUserId;

  async function act(action: "suspend" | "unsuspend" | "send_reset" | "resend_invite", label: string) {
    setBusy(true); setMsg(null);
    try {
      // The same two doors the directory uses: a reset has its own governed route, the rest are owner actions.
      const res = action === "send_reset"
        ? await fetch("/api/super-admin/users/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id }) })
        : await fetch("/api/super-admin/users/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id, action }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) { setMsg({ kind: "err", text: j.error ?? `${label} failed.` }); return; }
      setMsg({ kind: "ok", text: action === "send_reset" ? j.message ?? "Reset requested." : `${label}: done.` });
      if (action !== "send_reset") onChanged();
    } catch { setMsg({ kind: "err", text: `${label} failed. Check your connection and try again.` }); }
    finally { setBusy(false); }
  }

  const acc = detail.account;
  const banned = acc.state === "ok" && acc.value.bannedUntil && new Date(acc.value.bannedUntil) > new Date();

  return (
    <SectionCard id="account" title="Account & Security">
      {acc.state !== "ok" ? <SourceNote state={acc.state} what="Sign-in records" /> : (
        <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label="Account created">{acc.value.createdAt ? formatDateTime(acc.value.createdAt) : <StatePill state="missing" />}</Field>
          <Field label="Last sign-in">{acc.value.lastSignInAt ? <>{formatDateTime(acc.value.lastSignInAt)} <span className="text-gray-500">({relTime(acc.value.lastSignInAt)})</span></> : <StatePill state="missing" why="The person has never signed in." />}</Field>
          <Field label="Email confirmed">{acc.value.emailConfirmed ? "Yes" : "Not yet"}</Field>
          <Field label="Invitation">{acc.value.invitedAt ? `Sent ${formatDateTime(acc.value.invitedAt)}${user.status === "pending" ? " · not yet accepted" : ""}` : <StatePill state="not_applicable" why="The account was not created by an invitation." />}</Field>
          <Field label="Access">{banned ? <span className="font-semibold text-[var(--cmp-text-critical)]">Suspended</span> : "Not suspended"}</Field>
          <Field label="Account type" hint="Administrative only. It grants no access.">{ACCOUNT_TYPE_LABEL[user.accountType]}</Field>
        </dl>
      )}

      <SubHead>Account type history</SubHead>
      {!classificationAvailable ? <SourceNote state="not_set_up" what="Account classification" />
        : detail.classification.state !== "ok" ? <SourceNote state={detail.classification.state} what="The account type history" />
        : detail.classification.value.length === 0 ? <p className="text-[13px] text-gray-700">Never classified. Unclassified until someone reviews it.</p>
        : (
          <ul className="space-y-1.5 text-[13px]">
            {detail.classification.value.map(h => (
              <li key={h.id} className="text-gray-800">
                <b>{ACCOUNT_TYPE_LABEL[h.from as AccountType] ?? h.from}</b> {"→"} <b>{ACCOUNT_TYPE_LABEL[h.to as AccountType] ?? h.to}</b>
                <span className="text-gray-500"> · {h.by} · {formatDateTime(h.at)}</span>
                {h.reason && <span className="block text-[12px] text-gray-600">{h.reason}</span>}
              </li>
            ))}
          </ul>
        )}

      <SubHead>Account actions</SubHead>
      <div className="flex flex-wrap gap-2">
        {canReset && !me && <button type="button" disabled={busy} onClick={() => act("send_reset", "Password reset")} className={btn}>Send password reset</button>}
        {canManage && user.status === "pending" && <button type="button" disabled={busy} onClick={() => act("resend_invite", "Invitation re-sent")} className={btn}>Resend invitation</button>}
        {canManage && (user.status === "suspended"
          ? <button type="button" disabled={busy} onClick={() => act("unsuspend", "Reactivated")} className={btn}>Reactivate account</button>
          : !me && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Suspend ${user.name}? They will be unable to sign in until reactivated.`)) void act("suspend", "Suspended"); }} className={btn}>Suspend account</button>)}
        {canManage && !me && <button type="button" disabled={busy} onClick={() => onDelete(user)} className={`${btn} text-[var(--cmp-text-critical)]`}>Delete account{"…"}</button>}
        {!canReset && !canManage && <p className="text-[12px] text-gray-500">You can view this account. Changes need a platform owner.</p>}
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </SectionCard>
  );
}

function mergeSaved(p: PersonalDetail, v: Record<string, string | null>): PersonalDetail {
  const pick = (k: string, cur: string | null) => (k in v ? v[k] ?? null : cur);
  return {
    ...p,
    givenName: pick("given_name", p.givenName), middleNames: pick("middle_names", p.middleNames),
    familyName: pick("family_name", p.familyName), fullName: pick("full_name", p.fullName),
    phone: pick("phone", p.phone), country: pick("country", p.country),
  };
}

// ── 6. Audit & History -- names and times, never what changed ────────────────────────────────────────────────

function AuditSection({ userId, initial }: { userId: string; initial: Src<AuditPage> }) {
  const [pages, setPages] = useState<Src<AuditPage>>(initial);
  const [rows, setRows] = useState(initial.state === "ok" ? initial.value.rows : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function more() {
    if (pages.state !== "ok") return;
    setBusy(true); setErr(false);
    try {
      const res = await fetch(`/api/super-admin/users/${userId}?section=audit&page=${pages.value.page + 1}`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { audit?: Src<AuditPage> };
      const next = j.audit;
      if (!res.ok || !next || next.state !== "ok") { setErr(true); return; }
      setRows(r => [...r, ...next.value.rows]);
      setPages(next);
    } catch { setErr(true); }
    finally { setBusy(false); }
  }

  return (
    <SectionCard id="audit" title="Audit & History" subtitle="What was done by this person and to this account, newest first. Names and times only.">
      {pages.state !== "ok" ? <SourceNote state={pages.state} what="The audit trail" />
        : rows.length === 0 ? <p className="text-[13px] text-gray-700">Nothing has been recorded for this account yet.</p>
        : (
          <>
            <ol className="flex flex-col gap-2">
              {rows.map(r => (
                <li key={r.id} className="border-l-2 border-gray-200 pl-3 text-[13px]">
                  <p className="text-gray-900"><span className="font-medium">{actionLabel(r.action)}</span>
                    <span className="text-gray-500"> · {r.direction === "on" ? "done to this account" : r.direction === "by" ? "done by this person" : "done by this person to their own account"}</span></p>
                  <p className="text-[12px] text-gray-500">{formatDateTime(r.at)}{r.entityType ? ` · ${r.entityType.replace(/_/g, " ")}` : ""}{r.actor ? ` · ${r.actor}` : ""}</p>
                </li>
              ))}
            </ol>
            {pages.value.more && <button type="button" disabled={busy} onClick={more} className={`${btn} mt-3`}>{busy ? "Loading…" : "Show older"}</button>}
            {err && <Notice kind="err">Older entries could not be loaded.</Notice>}
          </>
        )}
    </SectionCard>
  );
}

// ── 7. Competency & Passport -- authorised metadata only; the person's private records are Restricted ───────────

function CompetencySection({ user }: { user: UserRow }) {
  const bar = (pct: number | null, label: string) => (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      {pct === null ? <p className="mt-0.5"><StatePill state="missing" why="No assessment decisions have been recorded yet. This is not 0%." /></p> : (
        <>
          <p className="mt-0.5 text-[15px] font-bold tabular-nums text-gray-900">{pct}%</p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-gray-200" role="img" aria-label={`${label} ${pct}%`}>
            <div className={`h-full ${pct >= 80 ? "bg-[var(--cmp-color-success)]" : pct >= 50 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-critical)]"}`} style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  );
  return (
    <SectionCard id="competency" title="Competency & Passport" subtitle="Estate assessment decisions. The person's own records are theirs.">
      <div className="grid gap-4 sm:grid-cols-2">
        {bar(user.competencyPct, "Competency")}
        {bar(user.passportPct, "Passport (currently valid)")}
      </div>
      <p className="mt-2 text-[12px] text-gray-600">
        {user.decisionsTotal > 0
          ? `${user.decisionsOk} of ${user.decisionsTotal} assessed competencies decided competent or better, and ${user.decisionsCurrent} currently valid. ${user.activeAuthorizations} active clinical authorisation${user.activeAuthorizations === 1 ? "" : "s"}.`
          : "No assessment decisions recorded yet."}
      </p>
      <SubHead>Private to the person</SubHead>
      <ul className="grid gap-2 sm:grid-cols-2">
        {RESTRICTED_RECORDS.map(r => (
          <li key={r} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800">
            {r} <StatePill state="restricted" why="Private to the person. HQ is not permitted to read it." />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-gray-500">HQ never reads these. A person can share a Passport view themselves, and it is then theirs to give, not HQ&apos;s to open.</p>
    </SectionCard>
  );
}
