import { requireAnalyticsAccess } from "@/lib/analytics";
import { ModuleHeader } from "../ui";
import ScheduledClient, { type ScheduleRow, type Option, type DefOption } from "./ScheduledClient";

// Scheduled Reports module — recurring delivery of saved/built-in reports via
// the daily platform cron, as in-app notifications with a link to live data.

export const dynamic = "force-dynamic";

export default async function ScheduledReportsPage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();

  const [{ data: schedules }, { data: defs }, { data: people }] = await Promise.all([
    hospitalId
      ? admin.from("report_schedules")
          .select("id, name, dataset, definition_id, frequency, recipients, active, next_run_at, last_run_at, last_status")
          .eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("report_definitions").select("id, name").eq("hospital_id", hospitalId).order("name").limit(50)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("profiles").select("id, full_name, role, roles").eq("hospital_id", hospitalId).order("full_name").limit(600)
      : Promise.resolve({ data: [] }),
  ]);

  const staff: Option[] = (people ?? [])
    .filter(p => (p.roles?.length ? p.roles : [p.role]).some((r: string) => ["assessor", "educator", "hospital_admin"].includes(r)))
    .map(p => ({ id: p.id, name: p.full_name }));

  return (
    <div className="max-w-4xl">
      <ModuleHeader icon="⏰" title="Scheduled Reports" sub="Automated recurring reports — executed by the daily platform cron, delivered as in-app notifications linking to live data." />
      <ScheduledClient
        rows={(schedules ?? []) as unknown as ScheduleRow[]}
        definitions={(defs ?? []) as unknown as DefOption[]}
        staff={staff}
      />
      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: schedules execute in production via the platform cron (daily 06:00 UTC — daily/weekly/monthly cadences all process on that tick);
        locally nothing fires automatically. Delivery is in-app only — email needs an email service that isn&apos;t configured yet.
      </p>
    </div>
  );
}
