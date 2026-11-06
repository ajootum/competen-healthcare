// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

// HQ-RECORD-SEARCH-01 palette: with no sources it never fetches and keeps its sentence; a 403 drops the source and renders
// nothing; a 502 says the source failed instead of "nothing found".

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import HqSearchLauncher from "./HqSearchLauncher";

const dest = [{ label: "Policy Manager", href: "/super-admin/policy-manager", icon: "P", group: "Quality" }];
const source = { key: "policies" as const, product: "Competen Platform", module: "Policy Manager", recordType: "Governed policy", endpoint: "/api/hq/search/policies" };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); (globalThis as any).fetch = fetchMock; push.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const openAndType = async (text: string) => {
  fireEvent.click(screen.getByRole("button", { name: /Search HQ/ }));
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: text } });
};
const res = (status: number, body: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe("HqSearchLauncher record sources", () => {
  it("with no sources: no fetch, and the existing sentence stands", async () => {
    render(<HqSearchLauncher destinations={dest} />);
    await openAndType("zzzz");
    await new Promise(r => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing here matches that\. This searches the HQ destinations your positions open\./)).toBeTruthy();
  });

  it("with sources: debounced, grouped by product, module and record type, and a hit navigates", async () => {
    fetchMock.mockResolvedValue(res(200, { hits: [{ id: "1", code: "POL-1", title: "Alpha policy", href: "/super-admin/policy-manager/1" }], more: false }));
    render(<HqSearchLauncher destinations={dest} recordSources={[source]} />);
    await openAndType("alpha");
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/hq/search/policies?q=alpha");
    expect(await screen.findByText("Competen Platform · Policy Manager · Governed policy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Alpha policy/ }));
    expect(push).toHaveBeenCalledWith("/super-admin/policy-manager/1");
  });

  it("a one-character query makes no fetch", async () => {
    render(<HqSearchLauncher destinations={dest} recordSources={[source]} />);
    await openAndType("a");
    await new Promise(r => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 403 renders nothing for that source and is not retried", async () => {
    fetchMock.mockResolvedValue(res(403, { error: "x" }));
    render(<HqSearchLauncher destinations={dest} recordSources={[source]} />);
    await openAndType("alpha");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2000 });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(screen.queryByText(/failed/i)).toBeNull();
    expect(screen.queryByText(/Governed policy/)).toBeNull();
    const calls = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "alphab" } });
    await new Promise(r => setTimeout(r, 450));
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("a 502 says the source failed, not nothing found", async () => {
    fetchMock.mockResolvedValue(res(502, { error: "x" }));
    render(<HqSearchLauncher destinations={dest} recordSources={[source]} />);
    await openAndType("alpha");
    expect(await screen.findByText(/search failed: the source could not be read/i, {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText(/Nothing here matches that/)).toBeNull();
  });

  const second = { key: "staff" as const, product: "Competen Platform", module: "Positions and appointments", recordType: "HQ staff member", endpoint: "/api/hq/search/staff" };

  it("filters by module and record type from held sources only, and fetches only the chosen source", async () => {
    fetchMock.mockResolvedValue(res(200, { hits: [], more: false }));
    render(<HqSearchLauncher destinations={dest} recordSources={[source, second]} />);
    await openAndType("alpha");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 2000 });
    fireEvent.change(screen.getByLabelText("Module"), { target: { value: "Policy Manager" } });
    expect(screen.queryByLabelText("Record type")).toBeNull();
    fetchMock.mockClear();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/hq/search/policies?q=alpha");
  });

  it("a refused source disappears from the filter lists", async () => {
    fetchMock.mockImplementation(async (u: string) => (u.includes("staff") ? res(403, { error: "x" }) : res(200, { hits: [], more: false })));
    render(<HqSearchLauncher destinations={dest} recordSources={[source, second]} />);
    await openAndType("alpha");
    await waitFor(() => expect(screen.queryByLabelText("Module")).toBeNull(), { timeout: 2000 });
    expect(screen.queryByText("Positions and appointments")).toBeNull();
  });

  it("with one or no sources there is no filter", async () => {
    render(<HqSearchLauncher destinations={dest} recordSources={[source]} />);
    await openAndType("a");
    expect(screen.queryByLabelText("Module")).toBeNull();
  });
});
