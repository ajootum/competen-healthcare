/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { loadExecutiveCommand } from "./executive-command";

// A query builder that answers every chained call with the table's canned result.
function fakeAdmin(tables: Record<string, { data?: any[]; error?: any }>) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [] };
      const q: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (resolve: any) => resolve({ data: result.data ?? null, error: result.error ?? null });
          return () => q;
        },
      });
      return q;
    },
  };
}

const row = (d: any, k: string) => d.health.find((h: any) => h.name === k);
const metric = (d: any, k: string) => d.metrics.find((m: any) => m.label === k);

describe("Executive Command Centre: AI serving and incidents", () => {
  it("counts logged AI requests and is healthy when none failed", async () => {
    const d: any = await loadExecutiveCommand(fakeAdmin({ plat_ai_requests: { data: [{ status: "ok" }, { status: "refusal" }, { status: "ok" }] } }), 30);
    expect(metric(d, "AI Requests Processed")).toMatchObject({ value: "3", real: true });
    expect(row(d, "AI & Intelligence Platform")).toMatchObject({ status: "healthy", alerts: 0, href: "/super-admin/platform-ops/ai-gateway" });
  });

  it("reports a real zero, not 'not monitored', when the log is readable but empty", async () => {
    const d: any = await loadExecutiveCommand(fakeAdmin({ plat_ai_requests: { data: [] } }), 30);
    expect(metric(d, "AI Requests Processed")).toMatchObject({ value: "0", real: true });
    expect(row(d, "AI & Intelligence Platform").status).toBe("healthy");
  });

  it("warns on failed or unconfigured calls, but not on refusals", async () => {
    const d: any = await loadExecutiveCommand(fakeAdmin({ plat_ai_requests: { data: [{ status: "error" }, { status: "not_configured" }, { status: "refusal" }] } }), 30);
    expect(row(d, "AI & Intelligence Platform")).toMatchObject({ status: "warning", alerts: 2 });
  });

  it("stays 'not monitored' when the log cannot be read", async () => {
    const d: any = await loadExecutiveCommand(fakeAdmin({ plat_ai_requests: { error: { message: "relation does not exist" } } }), 30);
    expect(metric(d, "AI Requests Processed")).toMatchObject({ value: "—", real: false });
    expect(row(d, "AI & Intelligence Platform").status).toBe("not_monitored");
  });

  it("opens the incident list from Critical Incidents", async () => {
    const d: any = await loadExecutiveCommand(fakeAdmin({ op_escalations: { data: [{ level: 4, severity: "emergency", status: "open" }] } }), 30);
    expect(d.attention.find((a: any) => a.key === "incidents")).toMatchObject({ n: 1, href: "/super-admin/system/security#incidents" });
  });
});
