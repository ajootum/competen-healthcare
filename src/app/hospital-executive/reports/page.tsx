import { hexGuard, Head, Tabs, Stat, Card, Pill, Table, Foot } from "../_ui";
import { loadExecReports } from "@/lib/hex/reports";

export const dynamic = "force-dynamic";

// HEX Reports & Board Papers — executive reporting + live board-pack snapshot.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Board Papers", "Executive Reports", "Scheduled Reports", "Report Builder", "Data Explorer", "Exports"];

export default async function ExecReportsPage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecReports(admin, hid, isSuper);
  const head = <Head code="Hospital Executive" title="Reports & Board Papers" sub="Executive reporting, board packs and automated distribution." action={{ label: "Report builder →", href: "/admin/quality" }} />;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon="📄" tone="teal" label="Report definitions" value={k.definitions} />
        <Stat icon="🗓️" tone="blue" label="Scheduled reports" value={k.scheduled} sub="active" />
        <Stat icon="🗂️" tone="violet" label="Datasets covered" value={k.datasets} />
        <Stat icon="🕓" tone="slate" label="Last generated" value={k.lastRun ? new Date(k.lastRun).toLocaleDateString() : "—"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Board-pack snapshot" className="xl:col-span-2" right="live · ready to assemble">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {d.boardPack.map((b: any, i: number) => (
              <div key={i} className="border border-gray-100 rounded-lg px-3 py-2.5"><p className="text-[10px] text-gray-400 leading-tight">{b.label}</p><p className="text-lg font-bold text-gray-900 tabular-nums leading-tight mt-0.5">{b.value}</p></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">These headline figures are pulled live from the executive scorecard — the substance of the monthly board pack, ready to assemble. Formatted PDF/PPT export &amp; sign-off is the next phase.</p>
        </Card>

        <Card title="Scheduled reports">
          <Table cols={["Report", "Frequency", "Next", "Status"]} rows={d.schedules.map((s: any) => [
            <span key="n" className="font-medium text-gray-800 truncate block max-w-[130px]">{s.name}</span>,
            <span key="f" className="text-gray-500 capitalize">{s.frequency}</span>,
            <span key="x" className="text-gray-400 tabular-nums">{s.next ? new Date(s.next).toLocaleDateString() : "—"}</span>,
            <Pill key="s" text={s.active ? (s.status ?? "scheduled") : "paused"} tone={s.active ? (s.status === "failed" ? "rose" : "emerald") : "slate"} />,
          ])} empty="No scheduled reports." />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Report library">
          <Table cols={["Report", "Dataset", "Created by"]} rows={d.definitions.map((r: any) => [
            <span key="n" className="font-medium text-gray-800">{r.name}</span>,
            <span key="d" className="text-gray-500">{r.dataset}</span>,
            <span key="b" className="text-gray-400">{r.by ?? "—"}</span>,
          ])} empty="No report definitions yet." />
        </Card>

        <Card title="Distribution & export">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-1">📤</span>
            <p className="text-[12px] text-gray-500">Formatted export &amp; board distribution is the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Report definitions &amp; schedules are live above; PDF/PPT rendering, board-pack assembly with sign-off, and recipient distribution build on the report engine next.</p>
          </div>
        </Card>
      </div>

      <Foot>HEX Reports &amp; Board Papers — live over <code>report_definitions</code> + <code>report_schedules</code> (the report engine), with a board-pack snapshot composed from the executive scorecard (<code>loadExecutiveDashboard</code>). The report catalogue, schedules and board-pack data are real and tenant-scoped; formatted PDF/PPT export, board-pack assembly with executive sign-off, and automated distribution are the next build phase.</Foot>
    </div>
  );
}
