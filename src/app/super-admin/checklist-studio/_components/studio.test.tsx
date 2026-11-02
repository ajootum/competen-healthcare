// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/super-admin/checklist-studio" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { RESP_ASSESS, RESP_RULES, STAGE_RATING } from "@/lib/assessment/core/fixtures";
import { assembleContent } from "@/lib/assessment/studio/assemble";
import { availabilities, approvalStatus, CAP } from "@/lib/assessment/studio/transitions";
import type { ValidationReport } from "@/lib/assessment/studio/types";
import { VersionWorkspace, type VersionWorkspaceProps } from "./VersionWorkspace";
import { LibraryTable } from "./LibraryTable";
import { ItemEditor } from "./ItemEditor";
import { criterionMapping } from "@/lib/assessment/adapters/scholar/criteria";

afterEach(cleanup);

const content = assembleContent({
  versionNo: 1,
  groups: RESP_ASSESS.groups,
  sections: RESP_ASSESS.sections.map((s) => ({ ...s, id: s.stable_key, parent_section_id: null })),
  items: RESP_ASSESS.items.map((i) => ({ ...i, id: i.stable_key, section_id: i.section_key, scale_version_id: "SV1", evidence_requirement: i.evidence_requirement ?? {} })),
  fields: [], mappings: [], scales: new Map([["SV1", STAGE_RATING]]),
});
const report: ValidationReport = { ok: true, errors: [], warnings: [], tests: null, checkedAt: "2026-11-03T00:00:00Z" };
const choices = [{ versionId: "SV1", label: "Stage 0-6 (v1)", scale: STAGE_RATING, state: "published" as const }];
const lifeInput = {
  kind: "instrument" as const, state: "draft" as const, actorId: "me", caps: [CAP.view, CAP.author], authoredBy: ["me"], editedBy: [], involved: ["me"], contentHash: null,
  risk: "standard" as const, requiresDomainReview: false, deliveryModes: ["self_assessment"], decisions: [], need: { standard: 1, high: 1 }, validationErrors: 0,
};
const props = (over: Partial<VersionWorkspaceProps> = {}): VersionWorkspaceProps => ({
  versionId: "v1", instrument: { id: "i1", code: "CA-000001", name: "Respiratory checklist" }, versionNo: 1, state: "draft", content, canEdit: true, canPick: true,
  methods: [{ code: "self_assessment", label: "Self-assessment" }], scaleChoices: choices, terms: [], drift: {}, ruleTemplates: [{ id: "t1", label: "Staged template v1" }],
  scoring: RESP_RULES as unknown as Record<string, unknown>, scoringTests: [], scoringTemplateId: null, scoringHash: "h", layouts: [], defaultLayoutId: null, allowedLayoutIds: [],
  settings: {
    version: { id: "v1", title: "Respiratory", summary: null, purpose_code: "formative", method_codes: [], requires_domain_review: false, assess_capability: null, assign_capability: null, respondent_roles: ["self"], delivery_modes: ["self_assessment"], evidence_policy: {}, effective_from: null, review_due: null },
    tagTermIds: [], terms: [], purposes: [{ code: "formative", label: "Formative", publishable: true }], methods: [{ code: "self_assessment", label: "Self-assessment" }], editable: true, canValidate: true, report,
  },
  report, title: "Respiratory", timeline: [],
  lifecycle: { contentHash: null, availability: availabilities(lifeInput), approval: approvalStatus(lifeInput), requiresDomainReview: false, decisions: [], names: {} },
  ...over,
});

describe("Checklist Studio screens", () => {
  it("the version workspace draws all five tabs and each tab renders without error", () => {
    render(<div data-cmp-theme="platform"><VersionWorkspace {...props()} /></div>);
    for (const name of ["Content", "Scoring & Rules", "Design & Layout", "Settings & Review", "Preview"]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      expect(screen.getByRole("tabpanel")).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("tab", { name: "Settings & Review" }));
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeTruthy();
  });
  it("content: sections and items are listed, editing marks the content unsaved and Save becomes available", () => {
    render(<div data-cmp-theme="platform"><VersionWorkspace {...props()} /></div>);
    expect((screen.getByRole("button", { name: "Save content" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByText("Unsaved content changes")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save content" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getAllByRole("button", { name: /Move up|Move down/i }).length).toBeGreaterThan(0);
  });
  it("a frozen version is read-only: no Add section, and the reason is stated", () => {
    render(<div data-cmp-theme="platform"><VersionWorkspace {...props({ canEdit: false, state: "published" })} /></div>);
    expect((screen.getByRole("button", { name: "Add section" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/cannot be edited here/i)).toBeTruthy();
  });
  it("a mapped item shows the frozen wording read-only with a differs-from-framework flag", () => {
    const item = { ...content.items[0], mapping: criterionMapping({ competency_id: "c", competency_code: "C-1", competency_name: "Comp", domain_name: "D", skill_id: "s", sort_order: 1, component_code: null, wording: "Frozen criterion wording", framework_code: "F", framework_version: "1.0.0", framework_pub_status: "draft", competency_hash: "h", clinically_approved: true }) };
    render(<div data-cmp-theme="platform"><ItemEditor item={item} onChange={() => {}} groups={content.groups} sections={content.sections} methods={[]} scaleChoices={choices} terms={[]} drift={["The criterion wording has changed in the framework."]} disabled={false} /></div>);
    expect(screen.getByText("Frozen criterion wording")).toBeTruthy();
    expect(screen.getByText(/Differs from framework/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Prompt/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unlink from the framework" }));
  });
  it("the library filters by text and by state, and New instrument needs the author capability", () => {
    const rows = [
      { id: "a", code: "CA-000001", name: "Respiratory", kind: "assessment", family_code: "CA", family_label: "Competency", latest_version_id: "v", latest_version_no: 1, latest_state: "draft" as const, published_version_no: null, versions: 1, updated_at: "2026-11-03T00:00:00Z" },
      { id: "b", code: "DA-000001", name: "Chart audit", kind: "audit", family_code: "DA", family_label: "Documentation", latest_version_id: "w", latest_version_no: 2, latest_state: "published" as const, published_version_no: 2, versions: 2, updated_at: "2026-11-02T00:00:00Z" },
    ];
    const reg = { families: [{ code: "CA", label: "Competency" }], purposes: [{ code: "formative", label: "Formative", publishable: true }], methods: [], mappingKinds: [] };
    const { rerender } = render(<div data-cmp-theme="platform"><LibraryTable rows={rows} registries={reg} canAuthor={false} /></div>);
    expect((screen.getByRole("button", { name: "New instrument" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Search code or name"), { target: { value: "chart" } });
    const t = screen.getByRole("table");
    expect(within(t).queryByText("CA-000001")).toBeNull();
    expect(within(t).getByText("DA-000001")).toBeTruthy();
    rerender(<div data-cmp-theme="platform"><LibraryTable rows={rows} registries={reg} canAuthor /></div>);
    expect((screen.getByRole("button", { name: "New instrument" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
