// @vitest-environment jsdom
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READER_ZONE_COOKIE, formatForReader, type ReaderClock } from "@/lib/datetime";
import { ReaderClockProvider, useReaderClock } from "./ReaderClock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const realFormat = Intl.DateTimeFormat;
const setDeviceZone = (zone: string) => {
  // A plain function, because the code under test also calls `new Intl.DateTimeFormat(...)`. Only the no-argument call asks for the device's zone.
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
    const f = new realFormat(...args);
    if (args.length === 0) { const real = f.resolvedOptions.bind(f); f.resolvedOptions = () => ({ ...real(), timeZone: zone }); }
    return f;
  } as never);
};
const clearCookie = () => { document.cookie = `${READER_ZONE_COOKIE}=; Path=/; Max-Age=0`; };

function Sample() {
  return <p>{formatForReader("2026-11-06T21:00:00Z", useReaderClock(), "dateTime", "UTC")}</p>;
}

const mounted: Root[] = [];
async function mount(clock: ReaderClock | null) {
  const tree = <ReaderClockProvider clock={clock}><Sample /></ReaderClockProvider>;
  const html = renderToString(tree);
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  const errors: unknown[] = [];
  const consoleError = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a); });
  const root = await act(async () => hydrateRoot(host, tree, { onRecoverableError: e => errors.push(e) }));
  mounted.push(root);
  consoleError.mockRestore();
  return { html, host, errors, root };
}

beforeEach(() => { refresh.mockClear(); clearCookie(); });
afterEach(async () => {
  await act(async () => { for (const root of mounted.splice(0)) root.unmount(); });
  vi.restoreAllMocks(); clearCookie(); document.body.innerHTML = "";
});

describe("ReaderClockProvider", () => {
  it("the server and a browser in another zone render the same text, so hydration has nothing to correct", async () => {
    setDeviceZone("Asia/Tokyo");
    const { html, host, errors } = await mount({ zone: "Africa/Kampala", source: "choice" });
    expect(html).toContain("7 Nov 2026, 00:00 EAT");
    expect(host.textContent).toBe("7 Nov 2026, 00:00 EAT");
    expect(errors).toEqual([]);
  });

  it("this test can fail: text that differs between server and browser is reported", async () => {
    const Differs = () => <p>{typeof document === "undefined" ? "server" : "browser"}</p>;
    const host = document.createElement("div");
    vi.stubGlobal("document", undefined);
    host.innerHTML = renderToString(<Differs />);
    vi.unstubAllGlobals();
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mounted.push(await act(async () => hydrateRoot(host, <Differs />, { onRecoverableError: e => errors.push(e) })));
    consoleError.mockRestore();
    expect(errors).not.toEqual([]);
  });

  it("off: no cookie, no refresh, and the old text in the old zone", async () => {
    setDeviceZone("Asia/Tokyo");
    const { host, errors } = await mount(null);
    expect(host.textContent).toBe("6 Nov 2026, 21:00");
    expect(document.cookie).not.toContain(READER_ZONE_COOKIE);
    expect(refresh).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("first visit: the page used the network's estimate, so it stores the device zone and refreshes once", async () => {
    setDeviceZone("Africa/Kampala");
    await mount({ zone: "Europe/Amsterdam", source: "network" });
    expect(document.cookie).toContain(`${READER_ZONE_COOKIE}=Africa%2FKampala`);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("after that refresh nothing further happens, so it cannot loop", async () => {
    setDeviceZone("Africa/Kampala");
    await mount({ zone: "Europe/Amsterdam", source: "network" });
    refresh.mockClear();
    await mount({ zone: "Africa/Kampala", source: "device" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("the estimate was right: stores it with no refresh", async () => {
    setDeviceZone("Africa/Kampala");
    await mount({ zone: "Africa/Kampala", source: "network" });
    expect(document.cookie).toContain(`${READER_ZONE_COOKIE}=Africa%2FKampala`);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("the learner's own choice is never refreshed away", async () => {
    setDeviceZone("Asia/Tokyo");
    await mount({ zone: "Europe/London", source: "choice" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cookies blocked: the write does not hold, so it does not refresh", async () => {
    setDeviceZone("Africa/Kampala");
    const set = vi.spyOn(document, "cookie", "set").mockImplementation(() => {});
    await mount({ zone: "Europe/Amsterdam", source: "network" });
    expect(set).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("coming back to a tab after crossing a border stores the new zone and refreshes", async () => {
    setDeviceZone("Africa/Kampala");
    await mount({ zone: "Africa/Kampala", source: "device" });
    refresh.mockClear();
    setDeviceZone("Asia/Tokyo");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(document.cookie).toContain(`${READER_ZONE_COOKIE}=Asia%2FTokyo`);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
