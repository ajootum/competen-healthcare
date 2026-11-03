// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, within, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { RESP_ASSESS, RESP_RULES, uid } from "@/lib/assessment/core/fixtures";
import { STANDARD_CHECKLIST_LAYOUT } from "@/lib/assessment/core";
import AssessmentRunnerHost from "./AssessmentRunnerHost";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the Scholar runner's per-item Evidence label", () => {
  it("counts a note as soon as it is added", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, id: "ev-1" }), { status: 200 })));
    const { container } = render(
      <AssessmentRunnerHost instanceId="i1" def={RESP_ASSESS} rules={RESP_RULES} layout={STANDARD_CHECKLIST_LAYOUT} guidedLayout={null} initialResponses={{}} initialRevisions={{}}
        initialEvidence={[]} title="t" subtitle="s" methodLabels={{}} materials={[]} sessions={[]} readOnly={false} reportHref="/r" listHref="/l" />,
    );
    const a = container.querySelector<HTMLElement>(`article[data-item-key="${uid(15)}"]`)!;
    fireEvent.click(within(a).getByRole("button", { name: "Evidence (0)" }));
    fireEvent.change(within(a).getByLabelText("Add a note about why you rated yourself this way"), { target: { value: "Because I checked" } });
    fireEvent.click(within(a).getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(within(a).getByRole("button", { name: "Evidence (1)" })).toBeTruthy());
  });
});
