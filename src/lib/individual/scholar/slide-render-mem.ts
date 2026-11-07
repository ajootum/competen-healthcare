import { randomInt } from "node:crypto";
import { readdirSync, readFileSync, statfsSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";

// ── HOW MUCH MEMORY A DRAWING USES ── SCHOLAR-VISUAL-001 phase 2 ─────────────────────────────────────────────────────────
//
// A deck is drawn by three processes: this one, the worker it starts and the engine the worker starts. One preview run was killed for running out of
// memory with nothing on record, so the job logs what it sees, at each stage and every few seconds, because a killed run logs no end. Numbers only: never
// a file name, a learner id or a path. Linux only, so it does nothing elsewhere, and it can never fail a job.

const EVERY_MS = 5000;
const PREFIX = "[scholar-render-mem]";
/** Which instance this is, so runs that shared one can be told apart. A random number with no other meaning. */
const INSTANCE = randomInt(1_000_000);
let jobs = 0;

export type ProcessRow = { pid: number; ppid: number; rssMb: number; hwmMb: number };
export type Group = { rss: number; hwm: number };
export type Tree = { route: Group; worker: Group; engine: Group; sum: number };

const toMb = (bytes: number) => Math.round(bytes / 1048576);
const read = (path: string): string => { try { return readFileSync(path, "utf8"); } catch { return ""; } };

/** Pure. One /proc/<pid>/status. Null for a process with no memory of its own, or text it cannot read. */
export function statusRow(pid: number, status: string): ProcessRow | null {
  const n = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(status)?.[1]);
  const [ppid, rss, hwm] = [n("PPid"), n("VmRSS"), n("VmHWM")];
  if (!Number.isFinite(ppid) || !Number.isFinite(rss) || !Number.isFinite(hwm)) return null;
  return { pid, ppid, rssMb: Math.round(rss / 1024), hwmMb: Math.round(hwm / 1024) };
}

/** Pure. Sorts processes into this one, the worker (its children) and the engine (anything further down). Anything outside that tree is left out. */
export function groupTree(rows: readonly ProcessRow[], self: number): Tree {
  const tree: Tree = { route: { rss: 0, hwm: 0 }, worker: { rss: 0, hwm: 0 }, engine: { rss: 0, hwm: 0 }, sum: 0 };
  const byPid = new Map(rows.map(r => [r.pid, r]));
  const depth = (r: ProcessRow): number => {
    let d = 0;
    for (let at: ProcessRow | undefined = r; at && d < 16; at = byPid.get(at.ppid), d++) if (at.pid === self) return d;
    return -1;
  };
  for (const r of rows) {
    const d = depth(r);
    if (d < 0) continue;
    const g = d === 0 ? tree.route : d === 1 ? tree.worker : tree.engine;
    g.rss += r.rssMb;
    g.hwm = Math.max(g.hwm, r.hwmMb);
    tree.sum += r.rssMb;
  }
  return tree;
}

/** Pure. Null is "na": not readable here, which is itself worth knowing. */
export function memLine(f: { job: number; up: number; t: number; stage: string; tree: Tree; peak: Tree; cg: (number | null)[]; mem: (number | null)[]; tmp: number | null; load: number; cpus: number; instance: number }): string {
  const g = (x: Group) => `${x.rss}/${x.hwm}`;
  const na = (xs: (number | null)[]) => xs.map(x => x ?? "na").join("/");
  return `${PREFIX} inst=${f.instance} job=${f.job} up=${f.up} t=${f.t} stage=${f.stage} route=${g(f.tree.route)} worker=${g(f.tree.worker)} engine=${g(f.tree.engine)} sum=${f.tree.sum} peak=${f.peak.route.hwm}/${f.peak.worker.hwm}/${f.peak.engine.hwm}/${f.peak.sum} cg=${na(f.cg)} mem=${na(f.mem)} tmp=${f.tmp ?? "na"} load=${f.load.toFixed(1)} cpus=${f.cpus}`;
}

const figure = (path: string): number | null => { const text = read(path).trim(); return text && Number.isFinite(Number(text)) ? toMb(Number(text)) : null; };

/** Instance-wide, from the cgroup (v2, else v1): now, peak, limit. */
function cgroup(): (number | null)[] {
  const v2 = figure("/sys/fs/cgroup/memory.current");
  if (v2 !== null) return [v2, figure("/sys/fs/cgroup/memory.peak"), figure("/sys/fs/cgroup/memory.max")];
  return [figure("/sys/fs/cgroup/memory/memory.usage_in_bytes"), figure("/sys/fs/cgroup/memory/memory.max_usage_in_bytes"), figure("/sys/fs/cgroup/memory/memory.limit_in_bytes")];
}

function meminfo(): (number | null)[] {
  const text = read("/proc/meminfo");
  const n = (key: string) => { const m = new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(text); return m ? Math.round(Number(m[1]) / 1024) : null; };
  return [n("MemTotal"), n("MemAvailable")];
}

function tmpUsed(): number | null {
  try { const s = statfsSync(tmpdir()); return toMb((s.blocks - s.bfree) * s.bsize); } catch { return null; }
}

function processes(): ProcessRow[] {
  let names: string[] = [];
  try { names = readdirSync("/proc"); } catch { return []; }
  const rows: ProcessRow[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const row = statusRow(Number(name), read(`/proc/${name}/status`));
    if (row) rows.push(row);
  }
  return rows;
}

/** Starts logging for one job. `mark` logs a stage, `stop` logs the end and stops. Does nothing where /proc cannot be read. */
export function startMemLog(): { mark: (stage: string) => void; stop: (stage?: string) => void } {
  if (!read("/proc/self/status")) return { mark: () => {}, stop: () => {} };
  const started = Date.now();
  const job = ++jobs;
  const peak: Tree = { route: { rss: 0, hwm: 0 }, worker: { rss: 0, hwm: 0 }, engine: { rss: 0, hwm: 0 }, sum: 0 };
  const log = (stage: string) => {
    try {
      const tree = groupTree(processes(), process.pid);
      peak.route.hwm = Math.max(peak.route.hwm, tree.route.hwm);
      peak.worker.hwm = Math.max(peak.worker.hwm, tree.worker.hwm);
      peak.engine.hwm = Math.max(peak.engine.hwm, tree.engine.hwm);
      peak.sum = Math.max(peak.sum, tree.sum);
      console.log(memLine({ instance: INSTANCE, job, up: Math.round(process.uptime()), t: Math.round((Date.now() - started) / 1000), stage, tree, peak, cg: cgroup(), mem: meminfo(), tmp: tmpUsed(), load: loadavg()[0], cpus: availableParallelism() }));
    } catch { /* a log never fails a job */ }
  };
  log("start");
  const timer = setInterval(() => log("sample"), EVERY_MS);
  timer.unref?.();
  return { mark: log, stop: (stage = "end") => { clearInterval(timer); log(stage); } };
}
