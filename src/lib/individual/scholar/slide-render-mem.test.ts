import { describe, expect, it } from "vitest";
import { groupTree, memLine, statusRow, type ProcessRow } from "./slide-render-mem";

const row = (pid: number, ppid: number, rssMb: number, hwmMb: number): ProcessRow => ({ pid, ppid, rssMb, hwmMb });

describe("the memory log", () => {
  it("reads one process's status", () => {
    expect(statusRow(7, "Name:\tnode\nPPid:\t3\nVmHWM:\t 2048000 kB\nVmRSS:\t 1024000 kB\n")).toEqual({ pid: 7, ppid: 3, rssMb: 1000, hwmMb: 2000 });
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
    const line = memLine({ instance: 4821, job: 2, up: 314, t: 15, stage: "pdf", tree, peak: tree, cg: [1700, null, 2048], mem: [2048, 300], tmp: null, load: 1.25, cpus: 1 });
    expect(line).toMatch(/^\[scholar-render-mem\]( stage=[a-z]+| [a-z]+=[\d./na]+)+$/);
    expect(line).toContain("route=300/340");
    expect(line).toContain("cg=1700/na/2048");
    expect(line).toContain("tmp=na");
  });
});
