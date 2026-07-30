/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-018 — Competency Governance Deployment, Release & Migration Management.
// "How do approved governance changes move from validation into live operation safely?" Over the real config
// release + migration stores (authoring/execution stay in Studio Package Manager — cross-linked):
//   • configuration_releases (mig 099) — governance releases: channel (dev→production), rollout (immediate/
//     scheduled/phased/canary), status (draft→…→activated / rolled_back / failed), objects[].
//   • configuration_migration_jobs (mig 098) — export / import / ROLLBACK jobs with status (built/validated/
//     applied/rolled_back/failed) + object_count.
// From them: the release pipeline by channel + status, successful-release rate (§15), migration accuracy,
// rollback frequency (§11/§15). Deployment lifecycle (§6) + backward compatibility (§8) render as reference. No migration.

type Admin = any;
const CHANNELS = ["dev", "qa", "uat", "pilot", "production"] as const;

export async function loadGovernanceReleases(admin: Admin) {
  const [relRes, jobRes] = await Promise.all([
    admin.from("configuration_releases").select("release_key, name, channel, rollout, status, objects, scheduled_for, created_at").order("created_at", { ascending: false }).limit(500),
    admin.from("configuration_migration_jobs").select("job_type, status, object_count, created_by_name, created_at").order("created_at", { ascending: false }).limit(300),
  ]);

  const rels = (relRes.error ? [] : relRes.data ?? []) as any[];
  const jobs = (jobRes.error ? [] : jobRes.data ?? []) as any[];

  const relStatus: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  for (const r of rels) {
    relStatus[r.status] = (relStatus[r.status] ?? 0) + 1;
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + 1;
  }
  const live = (relStatus.activated ?? 0) + (relStatus.published ?? 0);
  const rolledBack = relStatus.rolled_back ?? 0;
  const failed = relStatus.failed ?? 0;
  const terminal = live + rolledBack + failed;
  const successRate = terminal ? Math.round((live / terminal) * 100) : null;

  const relList = rels.slice(0, 12).map((r) => ({
    key: r.release_key,
    name: r.name,
    channel: r.channel,
    rollout: r.rollout,
    status: r.status,
    objects: Array.isArray(r.objects) ? r.objects.length : 0,
    at: r.created_at,
  }));

  const jobByType: Record<string, number> = { export: 0, import: 0, rollback: 0 };
  const jobByStatus: Record<string, number> = { built: 0, validated: 0, applied: 0, rolled_back: 0, failed: 0 };
  for (const j of jobs) {
    if (j.job_type in jobByType) jobByType[j.job_type]++;
    if (j.status in jobByStatus) jobByStatus[j.status]++;
  }
  const migAccuracy = jobByStatus.applied + jobByStatus.failed ? Math.round((jobByStatus.applied / (jobByStatus.applied + jobByStatus.failed)) * 100) : null;
  const jobList = jobs.slice(0, 10).map((j) => ({ type: j.job_type, status: j.status, objects: j.object_count ?? 0, by: j.created_by_name ?? "—", at: j.created_at }));

  return {
    provisioned: rels.length > 0 || jobs.length > 0,
    kpis: {
      releases: rels.length,
      live,
      successRate,
      rolledBack: rolledBack + (jobByType.rollback ?? 0),
      failed: failed + jobByStatus.failed,
      jobs: jobs.length,
      migAccuracy,
    },
    channels: CHANNELS.map((c) => ({ channel: c, count: byChannel[c] ?? 0 })).filter((c) => c.count > 0),
    relStatus,
    relList,
    jobByType,
    jobByStatus,
    jobList,
  };
}
