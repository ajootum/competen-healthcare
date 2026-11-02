import { describe, expect, it } from "vitest";
import {
  MODE_LABEL, STATUS_LABEL, STATUS_TONE, VERSION_STATES, deriveStatus, isEnabledMode, pageCount, shapeRow, showingLabel, subLine, totalOf, versionLabel,
  type SearchRow,
} from "./shape";

const row = (over: Partial<SearchRow> = {}): SearchRow => ({
  id: "i1", code: "CA-000001", name: "Sample item", description: null, family_code: "CA", family_label: "Family Label",
  primary_domain_label: "Domain A", method_labels: ["Method A"], population_labels: ["Group A"], setting_labels: ["Setting A"],
  latest_version_no: 2, latest_state: "draft", published_version_no: 1, owner: "Competen Holdings",
  updated_at: "2026-11-03T10:00:00Z", published_at: "2026-11-01T10:00:00Z", total: "130", ...over,
});

describe("deriveStatus", () => {
  it("is the latest version's state", () => {
    for (const s of VERSION_STATES) expect(deriveStatus(s)).toBe(s);
  });
  it("is 'no version yet' for a registered-only instrument, never a blank or a guess", () => {
    expect(deriveStatus(null)).toBe("none");
    expect(deriveStatus(undefined)).toBe("none");
    expect(deriveStatus("")).toBe("none");
    expect(deriveStatus("live")).toBe("none");
    expect(STATUS_LABEL.none).toBe("No version yet");
  });
  it("has a label and a tone for every status", () => {
    for (const s of [...VERSION_STATES, "none"] as const) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
    }
  });
});

describe("version and sub-line", () => {
  it("writes versions as integers", () => {
    expect(versionLabel(1)).toBe("v1");
    expect(versionLabel(12)).toBe("v12");
    expect(versionLabel(null)).toBe("—");
    expect(versionLabel(0)).toBe("—");
  });
  it("joins population and context, dropping the empty side", () => {
    expect(subLine(["Group A"], ["Setting A"])).toBe("Group A · Setting A");
    expect(subLine(["Group A", "Group B"], [])).toBe("Group A, Group B");
    expect(subLine([], ["Setting C"])).toBe("Setting C");
    expect(subLine([], [])).toBe("");
  });
});

describe("shapeRow", () => {
  it("shapes the compact row", () => {
    const r = shapeRow(row());
    expect(r).toMatchObject({
      code: "CA-000001", familyLabel: "Family Label", primaryDomain: "Domain A", methods: ["Method A"],
      sub: "Group A · Setting A", version: "v2", status: "draft", statusLabel: "Draft", publishedVersionNo: 1, owner: "Competen Holdings",
    });
  });
  it("shows an instrument with no version as such", () => {
    const r = shapeRow(row({ latest_version_no: null, latest_state: null, published_version_no: null, published_at: null }));
    expect(r.status).toBe("none");
    expect(r.statusLabel).toBe("No version yet");
    expect(r.version).toBe("—");
    expect(r.publishedAt).toBeNull();
  });
  it("copes with null label arrays and owner", () => {
    const r = shapeRow(row({ method_labels: null, population_labels: null, setting_labels: null, owner: null }));
    expect(r.methods).toEqual([]);
    expect(r.sub).toBe("");
    expect(r.owner).toBe("Competen Holdings");
  });
});

describe("paging words", () => {
  it("reads the total from the first row, as a number", () => {
    expect(totalOf([row({ total: "130" }), row({ total: "130" })])).toBe(130);
    expect(totalOf([])).toBe(0);
  });
  it("says how much of how many is shown", () => {
    expect(showingLabel(50, 1203, 0)).toBe("Showing 1 to 50 of 1,203");
    expect(showingLabel(3, 103, 100)).toBe("Showing 101 to 103 of 103");
    expect(showingLabel(0, 0, 0)).toBe("Showing 0 of 0");
  });
  it("counts pages, never fewer than one", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(1203, 50)).toBe(25);
  });
});

describe("availability words", () => {
  it("enables only available and optional", () => {
    expect(isEnabledMode("available")).toBe(true);
    expect(isEnabledMode("optional")).toBe(true);
    expect(isEnabledMode("unavailable")).toBe(false);
    expect(isEnabledMode(null)).toBe(false);
    expect(MODE_LABEL.none).toBe("Not enabled");
  });
});
