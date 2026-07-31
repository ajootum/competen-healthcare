// OGS R001 governance banner — the "workspace → governed Office" chrome. Renders a workspace's
// constituted-office identity (official name, authority source, chair, state, charter, review cadence,
// the viewer's own appointment) at the top of a governed workspace. Presentational only; data comes from
// officeForWorkspace() in @/lib/ogs/office (fail-soft: real office when constituted, default identity otherwise).
import Link from "next/link";

type Office = {
  id: string; name: string; icon: string; officeType: string; scopeType: string; status: string;
  authoritySource: string | null; chairName: string | null; quorum: number; memberCount: number;
  charterVersion: string | null; nextReview: string | null; establishedAt: string | null;
  bound: boolean; viewerRole: string | null; source: "ogs" | "committee";
};

const STATE: Record<string, { label: string; dot: string; text: string }> = {
  active: { label: "Active", dot: "bg-[var(--cmp-color-success)]", text: "text-emerald-100" },
  approved: { label: "Approved", dot: "bg-[var(--cmp-color-success)]", text: "text-emerald-100" },
  under_review: { label: "Under review", dot: "bg-[var(--cmp-color-warning)]", text: "text-amber-100" },
  pending_approval: { label: "Pending approval", dot: "bg-[var(--cmp-color-warning)]", text: "text-amber-100" },
  proposed: { label: "Proposed", dot: "bg-[var(--cmp-color-information)]", text: "text-sky-100" },
  in_design: { label: "In design", dot: "bg-[var(--cmp-color-information)]", text: "text-sky-100" },
  suspended: { label: "Suspended", dot: "bg-[var(--cmp-color-error)]", text: "text-rose-100" },
  restructuring: { label: "Restructuring", dot: "bg-[var(--cmp-color-warning)]", text: "text-amber-100" },
  closing: { label: "Closing", dot: "bg-[var(--cmp-color-error)]", text: "text-rose-100" },
  dissolved: { label: "Dissolved", dot: "bg-gray-400", text: "text-gray-200" },
  archived: { label: "Archived", dot: "bg-gray-400", text: "text-gray-200" },
};
const ROLE_LABEL: Record<string, string> = { chair: "Chair", deputy_chair: "Deputy Chair", secretary: "Secretary", governance_lead: "Governance Lead", member: "Member", reviewer: "Reviewer", observer: "Observer", external_adviser: "External Adviser" };

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[9px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-[12px] text-slate-100 font-medium truncate">{value}</span>
    </div>
  );
}

export function GovernanceBanner({ office, href = "/office-governance" }: { office: Office; href?: string }) {
  const st = STATE[office.status] ?? { label: (office.status ?? "—").replace(/_/g, " "), dot: "bg-slate-400", text: "text-slate-200" };
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const target = office.bound && office.id ? `/office-governance/offices/${office.id}` : href;
  return (
    <div className="rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 border border-slate-700 px-4 py-3 text-white">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center text-lg shrink-0">{office.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] uppercase tracking-[0.12em] text-slate-400 font-semibold">Governed Office</span>
              <span className={`inline-flex items-center gap-1 text-[10px] ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}</span>
            </div>
            <h2 className="text-[15px] font-bold leading-tight truncate">{office.name}</h2>
            <p className="text-[11px] text-slate-400 truncate">{office.authoritySource ?? "Authority not set"} · {office.scopeType} scope</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {office.viewerRole && <span className="text-[10px] bg-white/10 rounded-full px-2 py-1 text-slate-100 whitespace-nowrap">Your role: {ROLE_LABEL[office.viewerRole] ?? office.viewerRole}</span>}
          <Link href={target} className="text-[11px] text-slate-200 hover:text-white border border-slate-600 rounded-lg px-2.5 py-1.5 whitespace-nowrap">{office.bound && office.id ? "Open office →" : "Governance →"}</Link>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-2 mt-3 pt-3 border-t border-slate-700/60">
        <Fact label="Chair" value={office.chairName ?? "Vacant"} />
        <Fact label="Members" value={office.memberCount ? `${office.memberCount}${office.quorum ? ` / ${office.quorum} quorum` : ""}` : "—"} />
        <Fact label="Charter" value={office.charterVersion ?? (office.bound ? "—" : "Not constituted")} />
        <Fact label="Established" value={fmt(office.establishedAt)} />
        <Fact label="Next review" value={fmt(office.nextReview)} />
      </div>
      {office.bound && office.id && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-2 border-t border-slate-700/60 text-[11px]">
          <span className="text-slate-500 uppercase tracking-[0.1em] text-[9px]">Governance</span>
          <Link href={`/office-governance/offices/${office.id}`} className="text-slate-300 hover:text-white">Dashboard</Link>
          <span className="text-slate-600">·</span>
          <Link href="/office-governance/meetings" className="text-slate-300 hover:text-white">Meetings &amp; votes</Link>
          <span className="text-slate-600">·</span>
          <Link href="/office-governance/decisions" className="text-slate-300 hover:text-white">Decisions</Link>
          <span className="text-slate-600">·</span>
          <Link href="/office-governance/offices" className="text-slate-300 hover:text-white">Manage</Link>
          <span className="text-slate-600">·</span>
          <Link href="/office-governance" className="text-slate-300 hover:text-white">Command centre</Link>
        </div>
      )}
      {!office.bound && (
        <p className="text-[10px] text-slate-400 mt-2">Showing this workspace&apos;s default governance identity — not yet bound to a constituted Office. Constituting an office in the Office Governance System will bind it here.</p>
      )}
      {office.bound && office.source === "committee" && (
        <p className="text-[10px] text-slate-400 mt-2">Resolved from the governance-committee mapping (v1). Applying the OGS foundation migration (116/117) upgrades this to a first-class Office with charter, appointments and lifecycle.</p>
      )}
    </div>
  );
}
