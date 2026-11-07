import { describe, expect, it } from "vitest";
import { cpuOfTree, groupTree, memLine, statCpuMs, statusRow, type ProcessRow } from "./slide-render-mem";

const row = (pid: number, ppid: number, rssMb: number, hwmMb: number, cpuMs = 0): ProcessRow => ({ pid, ppid, rssMb, hwmMb, cpuMs });

describe("the memory log", () => {
  it("reads one process's status", () => {
    expect(statusRow(7, "Name:\tnode\nPPid:\t3\nVmHWM:\t 2048000 kB\nVmRSS:\t 1024000 kB\n")).toEqual({ pid: 7, ppid: 3, rssMb: 1000, hwmMb: 2000, cpuMs: 0 });
  });

  it("leaves out a process with no memory of its own, and text it cannot read", () => {
    expect(statusRow(7, "Name:\tkthread\nPPid:\t2\n")).toBeNull();
    expect(statusRow(7, "")).toBeNull();
  });

  it("sorts the tree into route, worker and engine, and leaves out what is outside it", () => {
    const t = groupTree([row(1, 0, 50, 60), row(10, 1, 300, 340), row(20, 10, 90, 95), row(30, 20, 1400, 1500), row(31, 30, 10, 20)], 10);
    expect(t.route).toEqual({ rss: 300, hwm: 340 });
    expect(t.worker).toEqual({ rss: 90, hwm: 95 });
    expect(t.engine).toEqual({ rss: 1410, hwm: 1500 });
    expect(t.sum).toBe(1800);
  });

  it("carries numbers only, and says what it could not read", () => {
    const tree = groupTree([row(10, 1, 300, 340)], 10);
    const line = memLine({ instance: 4821, job: 2, attempt: 1, engineTry: 2, slides: [3, 10], up: 314, t: 15, stage: "failed_stalled", tree, peak: tree, cg: [1700, null, 2048], mem: [2048, 300], tmp: null, load: 1.25, cpus: 1 });
    expect(line).toMatch(/^\[scholar-render-mem\]( stage=[a-z_]+| [a-z]+=[\d./na]+)+$/);
    expect(line).toContain("route=300/340");
    expect(line).toContain("cg=1700/na/2048");
    expect(line).toContain("tmp=na");
    expect(line).toContain("attempt=1 try=2");
    expect(line).toContain("slides=3/10");
  });

  it("reads CPU time from a process's stat, whatever its name holds", () => {
    const stat = (name: string) => `42 (${name}) S 1 42 42 0 -1 4194304 100 0 0 0 150 50 0 0 20 0 3 0 100 0 0`;
    expect(statCpuMs(stat("node"))).toBe(2000);
    expect(statCpuMs(stat("a) b (c"))).toBe(2000);
    expect(statCpuMs("")).toBe(0);
  });

  it("adds CPU up over a process and everything under it, and nothing else", () => {
    const rows = [row(1, 0, 1, 1, 9000), row(10, 1, 1, 1, 100), row(20, 10, 1, 1, 200), row(30, 20, 1, 1, 400), row(40, 1, 1, 1, 800)];
    expect(cpuOfTree(rows, 20)).toBe(600);
    expect(cpuOfTree(rows, 99)).toBeNull();
    expect(groupTree(rows, 10).cpuMs).toBe(600);
  });
});
