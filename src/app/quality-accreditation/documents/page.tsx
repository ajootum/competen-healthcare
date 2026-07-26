import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Bars, Table, Foot } from "../_ui";
import { loadDocuments } from "@/lib/qaw/documents";

export const dynamic = "force-dynamic";

// QAW-008 Documents, Policies & Evidence Centre — central repository for controlled documents, policies,
// SOPs, guidelines and evidence. Grounded in adm_documents (spine) + policies (fallback) + evidence.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Document Library", "Policies & Procedures", "Evidence Repository", "Approvals", "Version Control", "Retention Schedule", "Templates", "Reports"];
const STATUS_TONE: Record<string, string> = { draft: "slate", in_review: "amber", pending_approval: "violet", published: "emerald", archived: "gray" };
const LIFECYCLE = [["📝", "Create", "Draft authored"], ["🔍", "Review", "Peer / SME review"], ["✅", "Approve", "Sign-off obtained"], ["📢", "Publish", "Released & acknowledged"], ["🔧", "Maintain", "Scheduled review"], ["🗄️", "Retire", "Archived / superseded"]];

export default async function DocumentsPage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadDocuments(admin, hid, isSuper);
  const head = <Head code="QAW-008 · Quality & Accreditation" title="Documents, Policies & Evidence Centre" sub="Central repository for controlled documents, policies, SOPs, guidelines and evidence." action={{ label: "+ New document", href: "/admin/quality" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The controlled-document library (<code>adm_documents</code>) and policy store (<code>policies</code>) are not provisioned yet.</p></Card></div>;
  const k = d.kpis;
  const pctOf = (n: number, tot: number) => (tot ? Math.round((n / tot) * 100) : 0);
  const approvalTotal = d.approvalFlow.reduce((a: number, s: any) => a + s.value, 0);

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="📄" tone="teal" label="Total documents" value={k.total} sub="controlled" />
        <Stat icon="📕" tone="blue" label="Policies & procedures" value={k.policiesProcs} sub="policy docs" />
        <Stat icon="📎" tone="indigo" label="Evidence items" value={k.evidence} sub="in repository" />
        <Stat icon="🔁" tone="amber" label="Docs need review" value={k.needReview} sub="past review date" />
        <Stat icon="🕓" tone="violet" label="Pending approvals" value={k.pendingApprovals} sub="in workflow" />
        <Stat icon="⏰" tone="rose" label="Expiring documents" value={k.expiring} sub="review due ≤30d" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Documents by category">
          {d.byCategory.length ? (
            <div className="flex items-center gap-2">
              <Donut segments={d.byCategory} total={k.total} label="Documents" size={130} />
              <Legend items={d.byCategory.slice(0, 7).map((x: any) => ({ label: x.label, value: x.value, tone: x.tone, pct: x.pct }))} />
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No documents recorded yet.</p>}
        </Card>

        <Card title="Document status overview">
          {d.statusBreak.some((s: any) => s.value > 0)
            ? <Bars items={d.statusBreak.filter((s: any) => s.value > 0).map((s: any) => ({ label: s.label, pct: pctOf(s.value, k.total), tone: s.tone, value: `${s.value} (${pctOf(s.value, k.total)}%)` }))} />
            : <p className="text-sm text-gray-400 py-8 text-center">No documents recorded yet.</p>}
        </Card>

        <Card title="Evidence by source">
          {d.evidenceBySource.length ? (
            <div className="flex items-center gap-2">
              <Donut segments={d.evidenceBySource} total={k.evidence} label="Evidence" size={130} />
              <Legend items={d.evidenceBySource.map((x: any) => ({ label: x.label, value: x.value, tone: x.tone, pct: x.pct }))} />
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No evidence items captured yet.</p>}
          <p className="text-[10px] text-gray-400 mt-3">Split by <code>evidence.kind</code> (evidence vs credential document) — the repository&apos;s two honest sources today.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Top documents" right="recent / published">
          <Table cols={["Document", "Type", "Status", "Version", "Review date"]} rows={d.topDocs.map((o: any) => [
            <span key="t" className="font-medium text-gray-800">{o.title}</span>,
            <span key="ty" className="text-gray-500 capitalize">{(o.doc_type || "").replace(/_/g, " ")}</span>,
            <Pill key="s" text={(o.status || "").replace(/_/g, " ")} tone={STATUS_TONE[o.status] ?? "slate"} />,
            <span key="v" className="text-gray-500 tabular-nums">{o.version ?? "—"}</span>,
            <span key="r" className="text-gray-500 tabular-nums">{o.review_date ?? "—"}</span>,
          ])} empty="No documents recorded yet." />
        </Card>

        <Card title="Documents expiring soon" right="by review date">
          <Table cols={["Document", "Type", "Review date", "Days left"]} rows={d.expiringSoon.map((o: any) => [
            <span key="t" className="text-gray-800">{o.title}</span>,
            <span key="ty" className="text-gray-500 capitalize">{(o.doc_type || "").replace(/_/g, " ")}</span>,
            <span key="r" className="text-gray-500 tabular-nums">{o.review_date ?? "—"}</span>,
            <Pill key="d" text={o.daysLeft < 0 ? `${Math.abs(o.daysLeft)}d overdue` : `${o.daysLeft}d`} tone={o.daysLeft < 0 ? "rose" : o.daysLeft <= 30 ? "amber" : "emerald"} />,
          ])} empty="No documents have a review date set." />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Approval workflow status">
          {approvalTotal > 0
            ? <Bars items={d.approvalFlow.map((s: any) => ({ label: s.label, pct: pctOf(s.value, approvalTotal), tone: s.tone, value: s.value }))} />
            : <p className="text-sm text-gray-400 py-8 text-center">No documents in the approval workflow yet.</p>}
          <p className="text-[10px] text-gray-400 mt-3">Stages read the document <code>status</code> enum (draft → published). A dedicated workflow store (reviewers, sign-off history) is next-phase.</p>
        </Card>

        <Card title="Recent activity" className="xl:col-span-2" right="newest documents">
          {d.recent.length ? (
            <ul className="space-y-1.5">
              {d.recent.map((r: any, i: number) => (
                <li key={i} className="flex items-center justify-between gap-2 text-[12.5px] border-b border-gray-50 pb-1.5 last:border-0 last:pb-0">
                  <span className="text-gray-700 truncate">{r.title}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-gray-400 capitalize hidden sm:inline">{(r.doc_type || "").replace(/_/g, " ")}</span>
                    <Pill text={(r.status || "").replace(/_/g, " ")} tone={STATUS_TONE[r.status] ?? "slate"} />
                    <span className="text-gray-400 tabular-nums">{r.when}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No document activity timestamps yet.</p>}
        </Card>
      </div>

      <Card title="Document lifecycle">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {LIFECYCLE.map(([icon, label, sub], i) => (
            <div key={i} className="flex items-center gap-1 shrink-0">
              <div className="flex flex-col items-center text-center w-24">
                <span className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center text-base">{icon}</span>
                <span className="text-[11px] font-medium text-gray-800 mt-1">{label}</span>
                <span className="text-[9px] text-gray-400 leading-tight">{sub}</span>
              </div>
              {i < LIFECYCLE.length - 1 && <span className="text-gray-300">→</span>}
            </div>
          ))}
        </div>
      </Card>

      <Foot>QAW-008 — live over <code>adm_documents</code> (the controlled-document library) + <code>policies</code> + <code>evidence</code>. Total documents, category and status mix, the expiring-review queue, approval-stage counts, evidence-source split and recent activity are all real and tenant-scoped.{d.spineSource === "policies" && " This tenant has no adm_documents rows yet, so the library falls back to the policies store."} Status and version are enum/text fields today; a unified approval-workflow (reviewers, sign-off) and version-history store is the next phase.</Foot>
    </div>
  );
}
